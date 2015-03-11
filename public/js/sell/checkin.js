var Checkin = function (locationManager, invoiceManager) {
    this.locationManager = locationManager;
    this.invoiceManager = invoiceManager;
    this.columns = [
        {
            property: 'imageTag',
            className: 'pph-itemPhoto',
            label: '<div class="glyphicon glyphicon-camera"></div>',
            width: 30
        },
        {
            label: 'Customer Name',
            property: 'safeCustomerName'
        }
    ];
    this.selectedTab = null;
};

$.extend(Checkin.prototype, $.eventEmitter);

Checkin.prototype.setup = function () {
    var self = this;
    var repeaterOptions = {
        dataSource: function (o,c) { self.data(o,c); },
        thumbnail_selectable: true,
        defaultView: 'thumbnail',
        list_selectable: true,
        list_noItemsHTML: '<h1>No customers are checked in.</h1>',
        thumbnail_noItemsHTML: '<h1>No customers are checked in.</h1>',
        thumbnail_itemRendered: addTabId
    };
    var sel = function (e,row) { self.checkinSelection(e,row); };
    $('#checkinGrid').repeater(repeaterOptions);
    $('#checkinGrid2').repeater(repeaterOptions);
    $('#checkinGrid').on('selected.fu.repeaterThumbnail', sel);
    $('#checkinGrid').on('deselected.fu.repeaterThumbnail', sel);
    $('#checkinGrid2').on('selected.fu.repeaterThumbnail', sel);
    $('#checkinGrid2').on('deselected.fu.repeaterThumbnail', sel);

    var rep = $('#checkinGrid').data('fu.repeater');
    rep.$search.on('keyup.fu.search', $.proxy(rep.render, rep, { clearInfinite: true, pageIncrement: null }));
    rep = $('#checkinGrid2').data('fu.repeater');
    rep.$search.on('keyup.fu.search', $.proxy(rep.render, rep, { clearInfinite: true, pageIncrement: null }));

    this.invoiceManager.on('clear', function () {
        self.selectedTab = null;
    });
};

Checkin.prototype.pollOnce = function (force) {
    var self = this;
    if (force || this.invoiceManager.invoice.items.length) {
        var loc = this.locationManager.getCurrentLocation();
        if (loc) {
            $.ajax({
                url: window.ajaxRoot+'/locations/api/' + loc.id + '/tabs',
                type: 'GET',
                error: function (r, msg, e) {
                    console.log('Location poll error', e);
                },
                success: function (res) {
                    if (res && res.tabs && res.tabs.length) {
                        self.tabs = res.tabs;
                        $('#checkedInCount').text(res.tabs.length).show();
                    } else {
                        self.tabs = null;
                        $('#checkedInCount').hide();
                    }
                }
            });
        }
    }
};

Checkin.prototype.ensurePolling = function () {
    var self = this;
    this.pollOnce();
    if (!this.interval) {
        this.interval = setInterval(function () {
            self.pollOnce();
        }, 10000);
    }
}

Checkin.prototype.data = function (opt, cb) {
    var t = this.tabs || [];
    for (var i = 0; i < t.length; i++) {
        t[i].safeCustomerName = $safe(t[i].customerName);
        t[i].imageTag = "<img src=\"" + t[i].photoUrl.replace("\"", "") +
        "\" width=\"40\" height=\"40\"/>";
        t[i].src = t[i].photoUrl;
        t[i].name = t[i].customerName;
    }
    if (opt.search) {
        t = _.filter(t, function (t) {
            if (t.customerName.toLowerCase().indexOf(opt.search.toLowerCase()) >= 0) {
                return true;
            }
            return false;
        });
    }
    var r = {
        items: t,
        start: 0,
        end: t.length,
        count: t.length,
        pages: 1,
        page: 1,
        columns: this.columns
    };
    cb(r);
};

function addTabId(h,c) {
    h.item.data('tab', h.itemData);
    c();
}


Checkin.prototype.checkinSelection = function (e,row) {
    if (e.type === 'selected') {
        this.selectedTab = $(row).data('tab');
        $('#customerPhoto').attr('src', this.selectedTab.photoUrl);
    } else {
        this.selectedTab = null;
        $('#customerPhoto').attr('src',window.scriptBase+'media/small_avatar.png')
    }
};

module.exports = Checkin;
