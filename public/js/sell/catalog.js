var Catalog = function (invoiceManager) {
    this.filterAny = true;
    this.selectedModel = '_';
    this.invoiceManager = invoiceManager;

    var self = this;
    AjaxDataSource.call(this, function () {
        return ajaxRoot + '/products/api/model/' + self.selectedModel + '?format=json';
    });
    this.searchProperties = ['name','displayTags','description'];
    this._columns = [
        {
            property: 'imageTag',
            label: '<div class="glyphicon glyphicon-camera"></div>',
            sortable: false,
            className: 'pph-itemPhoto',
            width: 60
        },
        {
            property: 'safeName',
            label: 'Name',
            sortable: true
        },
        {
            property: 'displayPrice',
            label: 'Price',
            sortable: true,
            className: 'text-right',
            width: 175
        }
    ];
};

Catalog.prototype = Object.create(AjaxDataSource.prototype);
Catalog.prototype.constructor = Catalog;

$.extend(Catalog.prototype, $.eventEmitter);

Catalog.prototype.setup = function (prefs) {
    var self = this;
    if (prefs.get('catalog')) {
        this.selectedModel = prefs.get('catalog');
    }

    this.categoryFilter = $("#categories").selectize({
        delimiter: ',',
        persist: false,
        openOnFocus: true,
        hideSelected: true,
        valueField: 'name',
        labelField: 'name',
        searchField: ['name'],
        plugins: ['remove_button'],
        create: false
    });

    this.categoryFilter[0].selectize.on('change', function () {
        $('#productGrid').repeater('render');
    });

    this.catalogSelectize = $('#catalog').selectize({
        maxItems: 1,
        persist: false,
        openOnFocus: true,
        valueField: 'id',
        labelField: 'name',
        searchField: ['name'],
        create: false
    });
    this.catalogSelectize.on('change', function () {
        var newModel = $(this).val();
        if (newModel !== self.selectedModel) {
            self.selectedModel = newModel;
            delete self.sourceData;
            prefs.set('catalog', newModel);
            $('#productGrid').repeater('render');
        }
    });

    $('#productGrid').repeater({
        dataSource: function (o,c) {
            self.data(o,c);
        },
        defaultView: 'list',
        list_selectable: true
    });

    var rep = $('#productGrid').data('fu.repeater');
    rep.$search.on('keyup.fu.search', $.proxy(rep.render, rep, { clearInfinite: true, pageIncrement: null }));

    /**
     * Handle option and variant selection
     */
    $('#variantDiv').on('click', 'button', function (e) {
        e.preventDefault();
        var parent = $(this).parent('[data-select]');

        if ($(this).hasClass('active')) {
            if (parent.data('select') !== 'exactlyOne') {
                $(this).removeClass('active');
            }
        } else {
            $(this).addClass('active');
            if (parent.data('select') === 'exactlyOne' || parent.data('select') !== 'any') {
                $(this).siblings().removeClass('active');
            }
        }
    });


    $('#productGrid').on('click', 'table>tbody>tr', function (e) {
        self.itemClick($(this), e);
    });
};

Catalog.prototype.itemClick = function (elt, e) {
    // Undo selection UI
    elt.removeClass('selected');
    elt.find('.repeater-list-check').remove();
    var product = elt.data("item_data");
    var variations = product.variations, options = product.options;
    if ((variations && variations.length) || (options && options.length)) {
        var v = $('#variantDiv');
        v.empty();
        v.data('product', product);
        if (variations && variations.length) {
            var vG = $('<div class="btn-group variants" role="group"/>');
            vG.attr('data-select', 'exactlyOne');
            for (var i = 0; i < variations.length; i++) {
                var btn = $('<button>', {class: 'btn btn-default', type: 'button'});
                btn.append($('<div/>', {text: variations[i].name, class: 'name'}));
                var price = '-';
                if (variations[i].price) {
                    price = accounting.formatMoney(variations[i].price);
                }
                btn.data('variant', variations[i]);
                if (i == 0) {
                    btn.addClass('active');
                }
                btn.append($('<div/>', {text: price, class: 'price'}));
                vG.append(btn);
            }
            v.append('<h3>Choose a variation</h3>');
            v.append(vG);
        }

        if (options && options.length) {
            for (var o = 0; o < options.length; o++) {
                v.append($('<h3/>', {text: options[o]}));
                for (var g = 0; g < this.model.options.length; g++) {
                    if (this.model.options[g].name.toLowerCase() === options[o].toLowerCase()) {
                        var vG = $('<div class="btn-group options" role="group"/>');
                        vG.attr('data-select', this.model.options[g].select);
                        for (var val = 0; val < this.model.options[g].values.length; val++) {
                            var btn = $('<button>', {class: 'btn btn-default', type: 'button'});
                            btn.append($('<div/>', {text: this.model.options[g].values[val].name, class: 'name'}));
                            var price = '-';
                            if (this.model.options[g].values[val].price) {
                                price = accounting.formatMoney(this.model.options[g].values[val].price);
                            }
                            btn.append($('<div/>', {text: price, class: 'price'}));
                            btn.data('optionValue', this.model.options[g].values[val]);
                            btn.data('optionGroup', this.model.options[g]);
                            vG.append(btn);
                        }
                        v.append(vG);
                    }
                }
            }
        }

        $('#optionModal').modal();
        return;
    }
    var item = new Invoice.Item(1, product.price, product.id);
    item.name = product.name;
    if (product.taxRateName && this.model.taxRates) {
        this.model.taxRates.forEach(function (t) {
            if (product.taxRateName == t.name) {
                item.taxRate = Invoice.Number(t.rate).times(100);
                item.taxName = t.name;
            }
        });
    }
    item.imageUrl = product.photoUrl;
    item._product = product;
    this.invoiceManager.invoice.addItem(item);
    $('#cartGrid').repeater('render');
};

// Ajax data source functions
Catalog.prototype.success = function (data, options, callback) {
    this.sourceData = data.products;
    this.model = data;
    var self = this;
    this.categoryFilter[0].selectize.load(function (cb) {
        cb(data.tags);
    });
    this.catalogSelectize[0].selectize.load(function (cb) {
        cb(data._savedModels);
        for (var i = 0; i < data._savedModels.length; i++) {
            if (data._savedModels[i].id == self.selectedModel) {
                self.catalogSelectize[0].selectize.setValue(data._savedModels[i].id);
            }
        }
    });
    this._buildResponse(options, callback);
};

Catalog.prototype.filter = function (data, options) {
    if (!this.categoryFilter) {
        return data;
    }
    var catval = this.categoryFilter[0].selectize.items;
    if (!catval||catval.length===0) {
        return data;
    }
    data = _.filter(data, function (item) {
        for (var i = 0; i < catval.length; i++) {
            if (item.tags && item.tags.indexOf(catval[i]) >= 0) {
                if (filterAny) {
                    return true;
                }
            } else if (!filterAny) {
                return false;
            }
        }
        return filterAny ? false : true;
    });
    return data;
};

Catalog.prototype.formatter = function (index, item) {
    item.safeName = $safe(item.name);
    item.displayPrice = accounting.formatMoney(item.price);
    if (item.variations && item.variations.length) {
        item.variationCount = item.variations.length;
        var minPrice = new BigNumber(item.variations[0].price), maxPrice = minPrice;
        for (var i = 0; i < item.variationCount; i++) {
            var vPrice = item.variations[i].price;
            if (!vPrice) {
                continue;
            }
            vPrice = new BigNumber(vPrice);
            if (vPrice.gt(maxPrice)) {
                maxPrice = vPrice;
            } else if (vPrice.lt(minPrice)) {
                minPrice = vPrice;
            }
        }
        minPrice = accounting.formatMoney(minPrice);
        maxPrice = accounting.formatMoney(maxPrice);
        if (maxPrice !== minPrice) {
            item.displayPrice = minPrice + ' - ' + maxPrice;
        }
    } else if (item.variationCount) {
        delete item.variationCount;
    }
    // TODO not sure this is sufficient escaping even though it's coming from our server.
    item.imageTag = "<img src=\"" +
    (item.photoUrl || (window.scriptBase+'media/image_default_138.png')).replace("\"", "") +
    "\" width=\"60\" height=\"60\"/>";
    if (item.tags) {
        item.displayTags = item.tags.join(', ');
    }
};

module.exports = Catalog;

