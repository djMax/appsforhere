var Cart = function (invoiceManager, checkinManager, paymentManager) {
    this.invoiceManager = invoiceManager;
    this.checkinManager = checkinManager;
    this.paymentManager = paymentManager;
    this.editingItem = null;
    this.columns = [
        {
            width: 10,
            className: 'pph-spacer'
        },
        {
            property: 'imageTag',
            className: 'pph-itemPhoto',
            width: 30
        },
        {
            property: 'nameDesc'
        },
        {
            property: 'qtyPrice',
            className: 'amt'
        },
        {
            width: 10
        }
    ];
};

$.extend(Cart.prototype, $.eventEmitter);

Cart.prototype.setup = function () {
    var self = this;
    $('#cartGrid').on('click', 'div.repeater-list-wrapper>table>tbody>tr', function () {
        var $this = $(this);
        var editingItem = self.editingItem = $this.data("item_data");
        // Undo selection UI
        $this.removeClass('selected');
        $this.find('.repeater-list-check').remove();
        if (editingItem && editingItem.special === 'tax') {

        } else if (editingItem && editingItem.special === 'discount') {
        } else if (editingItem && editingItem.special === 'add') {
            editingItem = null;
            $('#cartItemName').val('');
            $('#cartQty').val(1);
            $('#cartItemPrice').val('');
            $('#cartItemModal').modal();
        } else {
            $('#cartItemName').val(editingItem.item.name);
            $('#cartQty').val(editingItem.item.quantity.toString());
            $('#cartItemPrice').val(editingItem.item.unitPrice.toString());
            $('#cartItemModal').modal();
        }
    });


    $('#saveWithOptions').on('click', function (e) {
        var variant = $('#variantDiv div.variants button.active').data('variant');
        var options = $('#variantDiv div.options button.active');
        var product = $('#variantDiv').data('product');
        var price = (variant?variant.price:null)||product.price;
        var detailId = [variant||{}], desc = (variant?variant.name:null)||'';
        options.each(function (o) {
            var val = $(this).data('optionValue');
            detailId.push(val);
            if (desc.length > 0) { desc += ', '; }
            desc += val.name;
            if (val.price) {
                price = Invoice.Number(val.price).plus(price);
            }
        });
        var item = new Invoice.Item(1, price, product, JSON.stringify({opts:detailId}));
        item.name = product.name;
        item.description = desc;
        item.imageUrl = product.photoUrl;
        item._product = product;
        item._options = detailId;
        self.invoiceManager.invoice.addItem(item);
        $('#cartGrid').repeater('render');
        $('#optionModal').modal('hide');
    });

    $('#cartItemModal').on('shown.bs.modal', function () {
        if (self.editingItem && !self.editingItem.special) {
            $('#cartQty').focus();
        } else {
            $('#cartItemName').focus();
        }
    });

    $('#cartQty').on('keypress', function (e) {
        if (e.charCode === 32) {
            e.preventDefault();
            var inc = Invoice.Number($('#cartQty').val()).plus(1);
            $('#cartQty').val(inc.toString());
        }
    });
    $('#cartQty').zeninput({});
    $('#cartItemPrice').zeninput({});

    $('#saveCartItem').on('click', function (e) {
        e.preventDefault();
        if (self.editingItem && self.editingItem.item) {
            if (self.editingItem.item.name !== $('#cartItemName').val() ||
                !self.editingItem.item.unitPrice.equals($('#cartItemPrice').val())) {
                // Break this item off from its source
                self.editingItem.item.itemId = new Date().getTime();
            }
            self.editingItem.item.quantity = Invoice.Number($('#cartQty').val());
            self.editingItem.item.unitPrice = Invoice.Number($('#cartItemPrice').val());
        } else {
            var item = new Invoice.Item($('#cartQty').val(), $('#cartItemPrice').val(), new Date().getTime());
            item.name = $('#cartItemName').val();
            self.invoiceManager.invoice.addItem(item);
        }
        $('#cartGrid').repeater('render');
        $('#cartItemModal').modal('hide');
    });

    $('#removeCartItem').on('click', function (e) {
        var ix = $.inArray(self.editingItem.item, self.invoiceManager.invoice.items);
        self.invoiceManager.invoice.items.splice(ix, 1);
        $('#cartGrid').repeater('render');
        $('#cartItemModal').modal('hide');
    });

    $('#cartGrid').repeater({
        dataSource: function (o,c) { self.getData(o,c); },
        defaultView: 'list',
        list_selectable: true,
        list_rowRendered: function (helpers, callback) {
            if (helpers.rowData.special) {
                helpers.item.addClass('special-'+helpers.rowData.special);
            }
            callback();
        }
    });

    $('#charge').on('click', function () {
        var tots = self.invoiceManager.invoice.calculate();
        if (tots.total.toString() === '0') {
            return;
        }
        if (self.checkinManager.selectedTab) {
            self.paymentManager.checkinPayment();
            return;
        }
        self.emit('selectingPaymentType', tots);
        $('#checkinGrid2').repeater('render');
        self.paymentManager.show();
    });
};

Cart.prototype.getData = function (opt, cb) {
    var data = [], self = this, inv = this.invoiceManager.invoice;
    data.push({
        special: 'add',
        imageTag: '<img src="'+window.scriptBase+'media/image_default_138.png" height="40" width="40"/>',
        nameDesc: 'New item...',
        qtyPrice: accounting.formatMoney(0)
    });
    inv.items.forEach(function (i) {

        var qtyPrice = '<div style="float:right;">' + accounting.formatMoney(i.totalForInvoice(inv).toString()) + '</div>';
        qtyPrice += '<span class="badge">' + i.quantity + '</span>';
        var nd = $safe(i.name);
        if (i.description) {
            nd += $('<div/>', {class: 'itemDesc', text: i.description}).prop('outerHTML');
        }
        data.push({
            item: i,
            nameDesc: nd,
            qtyPrice: qtyPrice,
            imageTag: "<img src=\"" +
            (i.photoUrl || (window.scriptBase+'media/image_default_138.png')).replace("\"", "") +
            "\" width=\"40\" height=\"40\"/>"
        });
    });
    var tots = inv.calculate();
    data.push({
        special: 'discount',
        imageTag: '<img src="'+window.scriptBase+'media/ic_sale_discount.png" height="40" width="40"/>',
        nameDesc: 'Discount',
        qtyPrice: accounting.formatMoney('0')
    });
    data.push({
        special: 'tax',
        imageTag: '<img src="'+window.scriptBase+'media/ic_sale_percentage.png" height="40" width="40"/>',
        nameDesc: 'Tax',
        qtyPrice: accounting.formatMoney((tots.itemTax || 0).toString())
    });
    var r = {items: data, start: 0, end: data.length, count: data.length, pages: 1, page: 1, columns: self.columns};
    if (tots.total.toString() === '0') {
        $('#charge').prop('disabled', true);
    } else {
        $('#charge').prop('disabled', false);
    }
    $('#chargeBtnAmount').text(m$(tots.total.toString()));
    self.emit('rendered', {totals:tots});
    cb(r);
};

Cart.prototype.updateCustomerInfo = function () {
    var name, address, email, phone, inv = this.invoiceManager.invoice;
    if (inv.billingInfo) {
        name = inv.billingInfo.businessName || personalName(inv.billingInfo);
        address = addr(inv.billingInfo.address);
        phone = inv.billingInfo.phoneNumber;
    }
    email = inv.payerEmail;
    if (inv.payerEmail === 'noreply@here.paypal.com') {
        email = null;
    }
    $('#curCustomerName').toggleClass('placeholder', !name);
    $('#curCustomerEmail').toggleClass('placeholder', !email);
    $('#curCustomerName').text(name||'Customer Name');
    $('#curCustomerEmail').text(email||'someone@somewhere.com');
    $('#curCustomerAddress').html(address);
    $('#curCustomerPhone').text(phone);
}

module.exports = Cart;

function personalName(bi) {
    if (!bi) { return null; }
    var ret = "";
    if (bi.firstName) {
        ret = bi.firstName;
        if (bi.lastName) {
            ret += " ";
        }
    }
    if (bi.lastName) {
        ret += bi.lastName;
    }
    return ret.length > 0 ? ret : null;
}

function addr(info) {
    if (!info) { return null; }
    var ret = "";
    if (info.line1) {
        ret = info.line1;
    }
    if (info.line2) {
        ret += "<br/>" + info.line2;
    }
    if (info.city || info.state || info.postalCode) {
        ret += "<br/>";
        if (info.city) {
            ret += info.city;
            if (info.state) {
                ret += ',';
            }
            if (info.state || info.postalCode) {
                ret += ' ';
            }
            if (info.state) {
                ret += info.state;
                if (info.postalCode) {
                    ret += ' ';
                }
            }
            if (info.postalCode) {
                ret += info.postalCode;
            }
        }
    }
    return ret.length > 0 ? ret : null;
}
