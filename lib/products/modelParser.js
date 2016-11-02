/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2016 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';
var XLSX = require('xlsx');

var ModelParser = function () {
    // Logically private
    this._rows = null;
    this._categoryColumns = [];
    this._modifierColumns = [];
    this._columns = {};
    this._productIds = {};
    this._pidCount = 0;
    this._workingModifier = null;

    // Logically public
    this.taxRates = {};
    this.tags = {};
    this.products = [];
    this.model = {
        taxRates: [],
        products: [],
        tags: [],
        options: []
    };
};

var yesEx = /^[xytXYT]/;

function setNonEmpty(p, value, key) {
    if (value && (value = value.trim()).length) {
        p[key] = value;
    }
}

ModelParser.prototype = {
    parseXLS: function (sheetBuffer, cb) {
        try {
            var workbook = XLSX.read(sheetBuffer, {type: 'buffer'}),
                itemSheet = workbook.Sheets.Items,
                modSheet = workbook.Sheets.Modifiers,
                taxSheet = workbook.Sheets['Tax Rates'];

            this._applyTaxSheet(taxSheet);
            this._writeTaxRates();
            this._applyModSheet(modSheet);
            this._applyItemSheet(itemSheet);
            cb(null, this.model);
        } catch (ex) {
            cb(ex);
        }
    },
    _applyItemSheet: function (itemSheet) {
        if (itemSheet) {
            this._columns = {};
            this._rows = [null]; // readProducts assumes 0 is the header row
            var range = this._readXlsHeaders(itemSheet);
            this.products = [];
            for (var row = range.s.r + 1; row <= range.e.r; row++) {
                var rowContent = [];
                for (var col = 0; col <= range.e.c; col++) {
                    rowContent.push(this._xlsVal(itemSheet, row, col));
                }
                this._rows.push(rowContent);
            }
            this._readProducts();
        }
    },
    _applyTaxSheet: function (taxSheet) {
        if (taxSheet) {
            this.model.taxRates = [];
            var range = this._readXlsHeaders(taxSheet);
            if (this._columns.name === undefined || this._columns.percentage === undefined) {
                throw new Error('The Tax Rates worksheet must have name and percentage columns.');
            }
            for (var row = range.s.r + 1; row <= range.e.r; row++) {
                var rate = this._xlsVal(taxSheet, row, this._columns.percentage),
                    name = this._xlsVal(taxSheet, row, this._columns.name),
                    taxId = this._xlsVal(taxSheet, row, this._columns.id),
                    isDefault = this._xlsVal(taxSheet, row, this._columns['defaultrate?']);
                this._saveTaxRate(rate, name, taxId, isDefault && yesEx.test(isDefault));
            }
        }
    },
    _applyModSheet: function (modSheet) {
        if (modSheet) {
            this.model.options = [];
            this._columns = {};
            var range = this._readXlsHeaders(modSheet);
            if (this._columns.modifiername === undefined || this._columns.valuename === undefined) {
                throw new Error('The Modifiers worksheet must have Modifier Name and Value Name columns.');
            }
            this._walkMods(modSheet, range);
        }
    },
    _readMod: function (modSheet, row) {
        return {
            modName: this._xlsVal(modSheet, row, this._columns.modifiername),
            valueName: this._xlsVal(modSheet, row, this._columns.valuename),
            price: this._xlsVal(modSheet, row, this._columns.price),
            isRequired: this._xlsVal(modSheet, row, this._columns.required)
        };
    },
    _makeModifier: function (r) {
        return {
            name: r.modName,
            select: r.isRequired ? r.isRequired.replace(/\s/g, '') : 'any',
            values: []
        };
    },
    _readModifierRow: function (r) {
        if (r.modName && this._workingModifier && r.modName !== this._workingModifier.name) {
            this.model.options.push(this._workingModifier);
            this._workingModifier = this._makeModifier(r);
        } else if (!this._workingModifier) {
            this._workingModifier = this._makeModifier(r);
        }
        if (r.valueName) {
            this._workingModifier.values.push({
                name: r.valueName,
                price: r.price
            });
        }
    },
    _walkMods: function (modSheet, range) {
        this._workingModifier = null;
        for (var row = range.s.r + 1; row <= range.e.r; row++) {
            var r = this._readMod(modSheet, row);
            if (!this._workingModifier && !r.modName) {
                throw new Error('The first row in the modifier worksheet must have a modifier name.');
            }
            this._readModifierRow(r);
        }
        if (this._workingModifier) {
            this.model.options.push(this._workingModifier);
        }
    },
    _xlsVal: function (sheet, row, col) {
        if (col === undefined || row === undefined) {
            return null;
        }
        var cell = sheet[XLSX.utils.encode_cell({r: row, c: col})];
        if (!cell) {
            return null;
        }
        // TODO be smart about percentages and such
        var str = String(cell.v);
        if (str.length === 0) {
            str = null;
        }
        return str;
    },
    _readXlsHeaders: function (sheet) {
        var range = XLSX.utils.decode_range(sheet['!ref']);
        var headerCols = [];
        for (var col = 0; col <= range.e.c; col++) {
            var cell = sheet[XLSX.utils.encode_cell({c: col, r: range.s.r})];
            if (cell && cell.v) {
                headerCols.push(cell.v);
            } else {
                headerCols.push('');
            }
        }
        this._readHeaders(headerCols);
        return range;
    },
    parse: function (rows) {
        this._rows = rows;
        this._readHeaders(rows[0]);
        if (this._columns.name === undefined || this._columns.price === undefined) {
            throw new Error('Must have name and price columns.');
        }
        this._findTaxTagsAndIds();
        this._writeTaxRates();
        for (var tagKey in this.tags) {
            this.model.tags.push({name: this.tags[tagKey]});
        }
        this._readProducts();
        return this.model;
    },
    _writeTaxRates: function () {
        var taxId = 1, foundDefault = false;
        for (var taxRateName in this.taxRates) {
            this.model.taxRates.push({
                default: !foundDefault && this.taxRates[taxRateName].default,
                rate: String(this.taxRates[taxRateName].rate),
                name: taxRateName,
                // TODO select more intelligently since you can specify the id
                id: this.taxRates[taxRateName].id || String(taxId++)
            });
            foundDefault = this.taxRates[taxRateName].default || foundDefault;
        }
    },
    /* Example columns:
     id	name	description	price	photoUrl	barcode	category	category	category	category	taxRateName	taxRate
     */
    _readHeaders: function (header) {
        for (var i = 0; i < header.length; i++) {
            if (header[i].toLowerCase() === 'category') {
                this._categoryColumns.push(i);
            }
            if (header[i].toLowerCase() === 'modifier') {
                this._modifierColumns.push(i);
            }
            this._columns[header[i].replace(/\s/g, '').toLowerCase()] = i;
        }
    },
    _checkForTax: function (row) {
        if (this._columns.taxratename !== undefined && row[this._columns.taxratename]) {
            var rateName = row[this._columns.taxratename].trim();
            var rate = row[this._columns.taxrate];
            this._saveTaxRate(rate, rateName);
        }
    },
    _saveTaxRate: function (rate, rateName, id, isDefault) {
        if (!rate || (rate = rate.trim()).length === 0) {
            throw new Error('No tax rate specified for rate named ' + rateName);
        }
        if (this.taxRates[rateName] && this.taxRates[rateName].rate !== rate) {
            throw new Error('You cannot have multiple tax rates with the same name but different rates.');
        }
        if (!this.taxRates[rateName]) {
            this.taxRates[rateName] = {
                rate: rate,
                name: rateName,
                id: id,
                default: isDefault
            };
        }
    },
    _findTaxTagsAndIds: function () {
        for (var i = 1; i < this._rows.length; i++) {
            this._checkForTax(this._rows[i]);
            var tags = this._readTags(this._rows[i]) || [];
            for (var j = 0; j < tags.length; j++) {
                var rawTag = tags[j];
                if (!this.tags[rawTag.toLowerCase()]) {
                    this.tags[rawTag.toLowerCase()] = rawTag;
                }
            }
            if (this._rows[i][this._columns.id] && this._productIds[this._rows[i][this._columns.id]]) {
                throw new Error('Duplicate product id ' + this._rows[i][this._columns.id]);
            } else {
                this._productIds[this._rows[i][this._columns.id]] = 1;
            }
        }
    },
    _readOptions: function (productRow) {
        var options = null;
        for (var j = 0; j < this._modifierColumns.length; j++) {
            var ci = this._modifierColumns[j];
            var rawOption = (productRow[ci] || '').trim();
            if (rawOption.length) {
                options = options || [];
                options.push(rawOption);
            }
        }
        return options;
    },
    _readTags: function (productRow) {
        var tags = null;
        for (var j = 0; j < this._categoryColumns.length; j++) {
            var ci = this._categoryColumns[j];
            var rawTag = productRow[ci] || '';
            rawTag = rawTag.trim();
            if (rawTag.length) {
                tags = tags || [];
                tags.push(rawTag);
            }
        }
        return tags;
    },
    _readVariation: function (row) {
        var p = this.model.products[this.model.products.length - 1];
        var v = {};
        setNonEmpty(v, row[this._columns.variation], 'name');
        setNonEmpty(v, row[this._columns.id], 'id');
        setNonEmpty(v, row[this._columns.price], 'price');
        setNonEmpty(v, row[this._columns.barcode], 'barcode');
        setNonEmpty(v, row[this._columns.sku], 'barcode');
        p.variations = p.variations || [];
        p.variations.push(v);
    },
    _setId: function (row, p) {
        setNonEmpty(p, row[this._columns.id], 'id');
        if (!p.id) {
            while (this._productIds[++this._pidCount]) {
            }
            p.id = this._pidCount;
        }
    },
    _readProduct: function (row) {
        var p = {};
        this._setId(row, p);
        setNonEmpty(p, row[this._columns.name], 'name');
        setNonEmpty(p, row[this._columns.description], 'description');
        setNonEmpty(p, row[this._columns.photourl], 'photoUrl');
        setNonEmpty(p, row[this._columns.price], 'price');
        setNonEmpty(p, row[this._columns.barcode], 'barcode');
        setNonEmpty(p, row[this._columns.sku], 'barcode');
        setNonEmpty(p, row[this._columns.taxratename], 'taxRateName');
        p.tags = this._readTags(row);
        p.options = this._readOptions(row);
        if (p.price) {
            p.price = p.price.replace(/[^0-9\.]/g, '');
        }
        if (p.name.length > 60) {
            p.name = p.name.substring(0, 59);
        }
        if (row[this._columns.pricevaries] && yesEx.test(row[this._columns.pricevaries])) {
            p.priceType = 'VARIABLE';
        }
        if (row[this._columns.sellfractional] && yesEx.test(row[this._columns.sellfractional])) {
            p.quantityType = 'FRACTIONAL';
        }
        this.model.products.push(p);
    },
    _readProducts: function () {
        this._pidCount = 0;
        for (var i = 1; i < this._rows.length; i++) {
            var row = this._rows[i];
            if (this._columns.variation && row[this._columns.variation]) {
                this._readVariation(row);
            } else {
                this._readProduct(row);
            }
        }
    }
}
;

function writeHeaderRow(sheet, columns) {
    for (var i = 0; i < columns.length; i++) {
        var cell = {
            v: columns[i],
            t: 's',
            s: {
                fontId: 1
            }
        };
        sheet[XLSX.utils.encode_cell({c: i, r: 0})] = cell;
    }
}

function writeVariations(itemSheet, variations, rowCount) {
    if (variations && variations.length) {
        for (var vi = 0; vi < variations.length; vi++) {
            rowCount++;
            var variation = variations[vi];
            if (variation.id) {
                itemSheet[XLSX.utils.encode_cell({c: 0, r: rowCount})] = {v: variation.id, t: 's'};
            }
            if (variation.barcode) {
                itemSheet[XLSX.utils.encode_cell({c: 1, r: rowCount})] = {v: variation.barcode, t: 's'};
            }
            itemSheet[XLSX.utils.encode_cell({c: 3, r: rowCount})] = {v: variation.name, t: 's'};
            if (variation.price) {
                itemSheet[XLSX.utils.encode_cell({c: 5, r: rowCount})] = {v: variation.price, t: 'n'};
            }
        }
    }
    return rowCount;
}

function writeModsAndCats(itemSheet, p, rowCount, start, maxCats) {
    if (p.tags) {
        for (var catIx = 0; catIx < p.tags.length; catIx++) {
            itemSheet[XLSX.utils.encode_cell({c: start + catIx, r: rowCount})] = {v: p.tags[catIx], t: 's'};
        }
    }
    if (p.options) {
        for (var optIx = 0; optIx < p.options.length; optIx++) {
            itemSheet[XLSX.utils.encode_cell({c: start + maxCats + optIx, r: rowCount})] = {v: p.options[optIx], t: 's'};
        }
    }
}

function modifierSheet(hereApiModel) {
    var optSheet = {}, rowCount = 0;
    writeHeaderRow(optSheet, ['Modifier Name', 'Required', 'Value Name', 'Price']);
    if (hereApiModel.options) {
        hereApiModel.options.forEach(function (o) {
            rowCount++;
            optSheet[XLSX.utils.encode_cell({c: 0, r: rowCount})] = {v: o.name, t: 's'};
            optSheet[XLSX.utils.encode_cell({c: 1, r: rowCount})] = {v: o.select, t: 's'};
            if (o.values) {
                for (var oi = 0; oi < o.values.length; oi++) {
                    if (oi) {
                        rowCount++;
                    }
                    optSheet[XLSX.utils.encode_cell({c: 2, r: rowCount})] = {v: o.values[oi].name, t: 's'};
                    if (o.values[oi].price) {
                        optSheet[XLSX.utils.encode_cell({c: 3, r: rowCount})] = {v: o.values[oi].price, t: 'n'};
                    }
                }
            }
        });
    }
    optSheet['!ref'] = XLSX.utils.encode_range({e: {c: 3/*header columns*/, r: rowCount}, s: {c: 0, r: 0}});
    return optSheet;
}

function taxSheet(hereApiModel) {
    var sheet = {}, rowCount = 0;
    writeHeaderRow(sheet, ['Id', 'Name', 'Percentage', 'Default Rate?']);
    if (hereApiModel.taxRates) {
        hereApiModel.taxRates.forEach(function (t) {
            rowCount++;
            sheet[XLSX.utils.encode_cell({c: 0, r: rowCount})] = {v: t.id, t: 's'};
            sheet[XLSX.utils.encode_cell({c: 1, r: rowCount})] = {v: t.name, t: 's'};
            sheet[XLSX.utils.encode_cell({c: 2, r: rowCount})] = {v: t.rate, t: 'n', z: '0.00%'};
            sheet[XLSX.utils.encode_cell({c: 3, r: rowCount})] = {v: t.default, t: 'b'};
        });
    }
    sheet['!ref'] = XLSX.utils.encode_range({e: {c: 3/*header columns*/, r: rowCount}, s: {c: 0, r: 0}});
    return sheet;
}

ModelParser.toXLSX = function (hereApiModel) {
    var workbook = {
        SheetNames: [
            'Items',
            'Modifiers',
            'Tax Rates'
        ],
        Sheets: {}
    }, rowCount = 0;
    workbook.Sheets.Modifiers = modifierSheet(hereApiModel);
    workbook.Sheets['Tax Rates'] = taxSheet(hereApiModel);

    var itemSheet = workbook.Sheets.Items = {};
    var itemHeaders = ['Id', 'SKU', 'Name', 'Variation', 'Description', 'Price', 'Tax Rate Name', 'Price Varies', 'Sell Fractional', 'Photo URL'];
    // We'll need to add columns for each category and each modifier
    var maxCats = 1, maxMods = 1;
    if (hereApiModel.products) {
        hereApiModel.products.forEach(function (p) {
            if (p.tags && p.tags.length > maxCats) {
                maxCats = p.tags.length;
            }
            if (p.options && p.options.length > maxMods) {
                maxMods = p.options.length;
            }
        });
    }
    for (var catIx = 0; catIx < maxCats; catIx++) {
        itemHeaders.push('Category');
    }
    for (var modIx = 0; modIx < maxMods; modIx++) {
        itemHeaders.push('Modifier');
    }

    writeHeaderRow(itemSheet, itemHeaders);
    rowCount = 0;
    if (hereApiModel.products) {
        hereApiModel.products.forEach(function (p) {
            rowCount++;
            itemSheet[XLSX.utils.encode_cell({c: 0, r: rowCount})] = {v: p.id, t: 's'};
            if (p.barcode) {
                itemSheet[XLSX.utils.encode_cell({c: 1, r: rowCount})] = {v: p.barcode, t: 's'};
            }
            itemSheet[XLSX.utils.encode_cell({c: 2, r: rowCount})] = {v: p.name, t: 's'};
            itemSheet[XLSX.utils.encode_cell({c: 5, r: rowCount})] = {v: p.price, t: 'n'};
            if (p.description) {
                itemSheet[XLSX.utils.encode_cell({c: 4, r: rowCount})] = {v: p.description, t: 's'};
            }
            if (p.taxRateName) {
                itemSheet[XLSX.utils.encode_cell({c: 6, r: rowCount})] = {v: p.taxRateName, t: 's'};
            }
            itemSheet[XLSX.utils.encode_cell({c: 7, r: rowCount})] = {v: p.priceType && p.priceType.toLowerCase() === 'variable', t: 'b'};
            itemSheet[XLSX.utils.encode_cell({c: 8, r: rowCount})] = {v: p.quantityType && p.quantityType.toLowerCase() === 'fractional', t: 'b'};
            if (p.photoUrl) {
                itemSheet[XLSX.utils.encode_cell({c: 9, r: rowCount})] = {v: p.photoUrl, t: 's'};
            }
            writeModsAndCats(itemSheet, p, rowCount, 10, maxCats);
            rowCount = writeVariations(itemSheet, p.variations, rowCount);
        });
    }
    itemSheet['!ref'] = XLSX.utils.encode_range({e: {c: itemHeaders.length - 1, r: rowCount}, s: {c: 0, r: 0}});
    return XLSX.write(workbook, {
        bookSST: true,
        type: 'buffer'
    });
};

module.exports = ModelParser;
