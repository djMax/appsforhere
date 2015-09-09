var ProductDataSource = function (options) {

    this._columns = [
        {
            property: 'imageTag',
            label: '<div class="glyphicon glyphicon-camera"></div>',
            sortable: false,
            className: 'pph-itemPhoto',
            width: 40
        },
        {
            property: 'safeName',
            label: 'Name',
            sortable: true
        },
        {
            property: 'variationCount',
            label: 'Variations',
            sortable: true,
            width: 90,
            className: 'text-center'
        },
        {
            property: 'displayTags',
            label: 'Categories',
            sortable: false
        },
        {
            property: 'taxRateName',
            label: 'Tax',
            sortable: true,
            width: 125
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
                (item.photoUrl || '/media/image_default_138.png').replace("\"", "") +
                "\" width=\"40\" height=\"40\"/>";
            if (item.tags) {
                item.displayTags = $safe(item.tags.join(', '));
            }
        });
    }
};

ProductDataSource.prototype = {

    /**
     * Returns stored column metadata
     */
    columns: function () {
        return this._columns;
    },

    _buildResponse: function (options, callback) {
        var data = this.rawData;
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
        // PAGING
        var startIndex = options.pageIndex * options.pageSize;
        var endIndex = startIndex + options.pageSize;
        var end = (endIndex > count) ? count : endIndex;
        var pages = Math.ceil(count / options.pageSize);
        var page = options.pageIndex;
        var start = startIndex;

        data = data.slice(startIndex, endIndex);
        if (this._formatter) {
            this._formatter(data);
        }

        var resp = { items: data, start: start, end: end, count: count, pages: pages, page: page, columns: this._columns };
        callback(resp);
    },

    /**
     * Called when Datagrid needs data. Logic should check the options parameter
     * to determine what data to return, then return data by calling the callback.
     * @param {object} options Options selected in datagrid (ex: {pageIndex:0,pageSize:5,search:'searchterm'})
     * @param {function} callback To be called with the requested data.
     */
    data: function (options, callback) {
        if (this.rawData) {
            this._buildResponse(options, callback);
        } else {
            var self = this;
            $.ajax('/products/api/model/' + selectedModel + '?format=json', {
                dataType: 'json',
                type: 'GET'
            }).done(function (response) {
                    var exV = $('#catalogName').val();
                    $modelSelect[0].selectize.load(function (cb) {
                        cb(response._savedModels);
                        $modelSelect[0].selectize.setValue(selectedModel);
                    });
                    model = response;
                    // Make sure we have the main containers
                    response.products = response.products || [];
                    response.taxRates = response.taxRates || [];
                    response.tags = response.tags || [];
                    $categorySelect[0].selectize.load(function (cb) {
                        cb(model.tags);
                    });
                    if (model.taxRates) {
                        model.taxRates.forEach(function (t) {
                            t.nameWithRate = t.name + " (" + new BigNumber(t.rate).times(100).toString() + "%)";
                        });
                    }
                    model.products.forEach(function (p) {
                        if (p.variations) {
                            for (var i = 0; i < p.variations.length; i++) {
                                p.variations[i].nameWithPrice = nameWithPrice(p.variations[i].name, p.variations[i].price || p.price);
                            }
                        }
                    });
                    $taxSelect[0].selectize.load(function (cb) {
                        cb(model.taxRates || []);
                    });
                    renderTaxNav();
                    renderOptionNav();
                    $('#sidebarContent').fadeIn();
                    self.rawData = response.products;
                    self._buildResponse(options, callback);
                });
        }
    }
};

dataSource = new ProductDataSource();

function setupProductGrid() {
    $('#productGrid').on('click', 'table>tbody>tr', function () {
        var $this = $(this);
        // Undo selection UI
        $this.removeClass('selected');
        $this.find('.repeater-list-check').remove();
        var product = selectedProduct = $(this).data("item_data");
        showItem(product);
    });

    $('#addItem').on('click', function () {
        selectedProduct = null;
        var defaultProduct = {};
        if (model.taxRates) {
            for (var i = 0; i < model.taxRates.length; i++) {
                if (model.taxRates[i].default) {
                    defaultProduct.taxRateName = model.taxRates[i].name;
                }
            }
        }
        showItem(defaultProduct);
    });
    $('#uploadForm')
        .on('change', '.btn-file :file', function () {
            var input = $(this),
                numFiles = input.get(0).files ? input.get(0).files.length : 1,
                label = input.val().replace(/\\/g, '/').replace(/.*\//, '');
            $("#importModal").modal('hide');

            var formData = new FormData();
            formData.append('csvupload', $("#csvupload")[0].files[0]);
            formData.append('modelId', selectedModel);
            uploadSomething('/products/import', formData, function (err, rz) {
                $('#uploadForm')[0].reset();
                if (!err) {
                    location.reload();
                }
            });
        });
    $('#uploadXlsForm')
        .on('change', '.btn-file :file', function () {
            var input = $(this),
                numFiles = input.get(0).files ? input.get(0).files.length : 1,
                label = input.val().replace(/\\/g, '/').replace(/.*\//, '');
            $("#importModal").modal('hide');

            var formData = new FormData();
            formData.append('xlsupload', $("#xlsupload")[0].files[0]);
            formData.append('modelId', selectedModel);
            uploadSomething('/products/import', formData, function (err, rz) {
                $('#uploadXlsForm')[0].reset();
                if (!err) {
                    location.reload();
                }
            });
        });

    $modelSelect = $("#catalogName").selectize({
        delimiter: ',',
        persist: false,
        create: function (v) {
            document.location = document.location.origin + '/products/new/' + v;
        },
        maxItems: 1,
        sortField: 'name',
        valueField: 'id',
        labelField: 'name'
    });
    $modelSelect[0].selectize.on('change', function (newModel) {
        if (!newModel.length) {
            return;
        }
        if (newModel !== selectedModel) {
            var base = document.location.origin + '/products'
            if (newModel !== '_') {
                base += '/' + newModel;
            }
            document.location = base;
        }
    });
    $('#saveModel')
        .on('click', function () {
            $('#modelNameForm').data('bootstrapValidator').resetForm();
            $('#modelName').val(selectedModelName);
            $('#modelNameModal').modal();
        });

    $('#modelNameForm').bootstrapValidator({
        live: 'enabled',
        feedbackIcons: {
            valid: 'glyphicon glyphicon-ok',
            invalid: 'glyphicon glyphicon-remove',
            validating: 'glyphicon glyphicon-refresh'
        },
        fields: {
            modelName: {
                validators: {
                    notEmpty: {
                        message: 'A name is required.'
                    },
                    stringLength: {
                        min: 2,
                        message: 'Name must be at least 2 characters long.'
                    },
                    regexp: {
                        regexp: /^[a-z\s\-_0-9]+$/i,
                        message: 'Name must consist of letters, numbers, spaces, dashes or underscores.'
                    }
                }
            }
        }
    }).on('success.form.bv', function(e) {
        e.preventDefault();
        $('#modelNameModal').modal('hide');
        publishModel($('#modelName').val());
    });

    $('#productGrid').repeater({
        dataSource: function (o, c) {
            dataSource.data(o, c);
        },
        defaultView: 'list',
        list_selectable: true
    });

}
