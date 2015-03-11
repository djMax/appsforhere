var ModifierDataSource = function (options) {

    this._columns = [
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
            width: 125
        }
    ];

    this._formatter = function (items) {
        $.each(items, function (index, item) {
            item.displayPrice = accounting.formatMoney(item.price);
            item.safeName = $safe(item.name);
        });
    }
};

ModifierDataSource.prototype = {

    /**
     * Returns stored column metadata
     */
    columns: function () {
        return this._columns;
    },

    _buildResponse: function (options, callback) {
        var data = this.rawData || [];
        // Return data to Datagrid
        if (options.search) {
            data = _.filter(data, function (item) {
                var match = false;

                _.each(item, function (prop) {
                    if (_.isString(prop) || _.isFinite(prop)) {
                        if (prop.toString().toLowerCase().indexOf(options.search.toLowerCase()) !== -1) match = true;
                    }
                });

                return match;
            });
        }

        var count = data.length;

        if (options.sortProperty) {
            data = _.sortBy(data, options.sortProperty);
            if (options.sortDirection === 'desc') {
                data.reverse();
            }
        }
        if (this._formatter) {
            this._formatter(data);
        }

        var resp = { items: data, start: 0, end: data.length, count: data.length, pages: 1, page: 1, columns: this._columns };
        callback(resp);
    },

    /**
     * Called when Datagrid needs data. Logic should check the options parameter
     * to determine what data to return, then return data by calling the callback.
     * @param {object} options Options selected in datagrid (ex: {pageIndex:0,pageSize:5,search:'searchterm'})
     * @param {function} callback To be called with the requested data.
     */
    data: function (options, callback) {
        this._buildResponse(options, callback);
    }
};

modifierDataSource = new ModifierDataSource();

function renderOptionNav() {
    $('#optionRepeater li.modifier').remove();
    $modSelect[0].selectize.load(function (cb) {
       cb(model.options || []);
    });
    if (!model.options) {
        return;
    }
    var list = $('#optionRepeater');
    for (var i = model.options.length - 1; i >= 0; i--) {
        var mod = model.options[i];
        var li = $('<li></li>');
        li.addClass('modifier').prependTo(list);
        setupOptionNav(li, mod);
    }
}

function setupOptionNav(li, mod) {
    $('<a href="#"></a>').text(mod.name)
        .appendTo(li).data('mod_data', mod)
        .on('click', function () {
            selectedModifier = mod;
            modifierValuesBeingEdited = [];
            for (var vi = 0; mod.values && vi < mod.values.length; vi++) {
                modifierValuesBeingEdited.push({
                    name: mod.values[vi].name,
                    price: mod.values[vi].price
                });
            }
            modifierDataSource.rawData = modifierValuesBeingEdited;
            $('#modifierForm').data('bootstrapValidator').resetForm();
            $('#modifierGrid').repeater('render');
            $('#modName').val(mod.name);
            $('#modRequireOne').prop('checked', mod.select && mod.select.toLowerCase() === 'exactlyone');
            $('#modifierModal').modal();
        });
}

(function ($) {
    $.fn.bootstrapValidator.validators.uniqueModifier = {
        html5Attributes: {
            message: 'message',
            field: 'field',
            check_only_for: 'check_only_for'
        },
        validate: function (validator, $field, options) {
            var value = $field.val();
            if (!model.options || model.options.length == 0) {
                return true;
            }
            for (var i = 0; i < model.options.length; i++) {
                if (model.options[i] !== selectedModifier && model.options[i].name.toLowerCase() === value.toLowerCase()) {
                    return false;
                }
            }
            return true;
        }
    }
    $.fn.bootstrapValidator.validators.uniqueModifierValue = {
        html5Attributes: {
            message: 'message',
            field: 'field',
            check_only_for: 'check_only_for'
        },
        validate: function (validator, $field, options) {
            var value = $field.val();
            if (modifierValuesBeingEdited.length == 0) {
                return true;
            }
            for (var i = 0; i < modifierValuesBeingEdited.length; i++) {
                if (modifierValuesBeingEdited[i] !== selectedModifierValue && modifierValuesBeingEdited[i].name.toLowerCase() === value.toLowerCase()) {
                    return false;
                }
            }
            return true;
        }
    }
}(window.jQuery));

function saveModifierToLocalModel() {
    if (!selectedModifier) {
        selectedModifier = {};
        model.options = model.options || [];
        model.options.push(selectedModifier);
    }
    selectedModifier.name = $('#modName').val();
    selectedModifier.values = modifierValuesBeingEdited;
    selectedModifier.select = $('#modRequireOne').is(':checked') ? "exactlyOne" : "any";
    $('#modifierModal').modal('hide');
    selectedModifier = null;
    renderOptionNav();
    fillModifiers(null,true);
}

function saveModifierValueToLocalModel() {
    if (!selectedModifierValue) {
        selectedModifierValue = {};
    }
    modifierValuesBeingEdited.push(selectedModifierValue);
    selectedModifierValue.name = $('#modValueName').val();
    selectedModifierValue.price = $('#modValuePrice').val();
    $('#modifierGrid').repeater('render');
    $('#modValueModal').modal('hide');
}

function addModifier() {
    $('#modifierForm').data('bootstrapValidator').resetForm();
    $('#modName').val('');
    selectedModifier = null;
    modifierValuesBeingEdited = [];
    modifierDataSource.rawData = modifierValuesBeingEdited;
    $('#modifierGrid').repeater('render');
    $('#modifierModal').modal();

}

function showModValue() {
    $('#modValueForm').data('bootstrapValidator').resetForm();
    $('#modValueName').val("");
    $('#modValuePrice').val("");
    $('#modValueModal').modal();
}

function fillModifiers(selected,refresh) {
    $modSelect[0].selectize.clear();
    $modSelect[0].selectize.clearOptions();
    $modSelect[0].selectize.load(function (cb) {
        cb(model.options || []);
        if (selected && selected.length) {
            for (var i = 0; i < selected.length; i++) {
                $modSelect[0].selectize.addItem(selected[i]);
            }
        }
        if (refresh) {
            $modSelect[0].selectize.refreshItems();
        }
    });
}


function setupModifiers() {
    $('#modifierAdd').on('click', addModifier);
    $('#addModifierValue').on('click', showModValue);
    $('#modValuePrice').money_field();
    $('#modValueModal').on('shown.bs.modal', function () {
        $('#modValueName').focus();
    });

    $('#deleteModifier').on('click', function () {
       if (selectedModifier) {
           model.options.splice($.inArray(selectedModifier, model.options), 1);
           selectedModifier = selectedModifierValue = null;
           $('#modifierModal').modal('hide');
           renderOptionNav();
           fillModifiers(null, true);
       }
    });

    $('#deleteModValue').on('click', function () {
       if (selectedModifierValue) {
           modifierValuesBeingEdited.splice($.inArray(selectedModifierValue, modifierValuesBeingEdited), 1);
           selectedModifierValue = null;
           $('#modifierGrid').repeater('render');
       }
       $('#modValueModal').modal('hide');
    });

    $('#modifierForm').bootstrapValidator({
        live: 'enabled',
        submitButtons: "button.btn-primary",
        feedbackIcons: {
            valid: 'glyphicon glyphicon-ok',
            invalid: 'glyphicon glyphicon-remove',
            validating: 'glyphicon glyphicon-refresh'
        },
        fields: {
            modName: {
                validators: {
                    notEmpty: {
                        message: 'A name is required.'
                    },
                    uniqueModifier: {
                        message: 'The name of the modifier must be unique.'
                    }
                }
            }
        }
    }).on('success.form.bv', function(e) {
        e.preventDefault();
        saveModifierToLocalModel();
    });
    $('#modifierGrid').on('click', 'table>tbody>tr', function () {
        var $this = $(this);
        // Undo selection UI
        $this.removeClass('selected');
        $this.find('.repeater-list-check').remove();
        selectedModifierValue = $(this).data("item_data");
        showModValue(selectedModifierValue);
        $('#modValueName').val(selectedModifierValue.name);
        $('#modValuePrice').val(
            (parseInt(selectedModifierValue.price))?
                new BigNumber(selectedModifierValue.price).toFixed(2):
                "");
    });

    $('#modValueForm').bootstrapValidator({
        live: 'enabled',
        feedbackIcons: {
            valid: 'glyphicon glyphicon-ok',
            invalid: 'glyphicon glyphicon-remove',
            validating: 'glyphicon glyphicon-refresh'
        },
        fields: {
            modValueName: {
                validators: {
                    notEmpty: {
                        message: 'A name is required.'
                    },
                    uniqueModifierValue: {
                        message: 'The name of the modifier value must be unique.'
                    }
                }
            },
            modValuePrice: {
                validators: {
                    numeric: {
                        message: 'A valid price is required (or 0)'
                    }
                }
            }
        }
    }).on('success.form.bv', function(e) {
        e.preventDefault();
        saveModifierValueToLocalModel();
    });

}

$('#modifierGrid').repeater({
    dataSource: function (o, c) {
        modifierDataSource.data(o, c);
    },
    defaultView: 'list',
    list_selectable: true
});
