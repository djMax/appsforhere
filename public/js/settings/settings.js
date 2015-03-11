var $delegateFeatureSelect, dataSource, selectedDelegate, selectedDevice, fakePassword = '••••••••••••';

var allRoles = [
    {text: 'View Products', value: 'ViewProducts'},
    {text: 'Edit Products', value: 'EditProducts'},
    {text: 'View Sales Reports', value: 'ViewReports'},
    {text: 'View Locations', value: 'ViewLocations'},
    {text: 'Edit Locations', value: 'EditLocations'},
    {text: 'Save to Vault', value: 'SaveVault'}
];

var HardwareDataSource = function (options) {
    AjaxDataSource.call(this, function () {
        return '/devices/all';
    });
    this._columns = [
        {
            property: 'host',
            label: 'Host',
            sortable: true
        },{
            property: 'safeName',
            label: 'Device Name'
        },{
            property: 'id',
            label: 'Device Id'
        }
    ];
};
HardwareDataSource.prototype = Object.create(AjaxDataSource.prototype);
HardwareDataSource.prototype.constructor = HardwareDataSource;
HardwareDataSource.prototype.success = function (data, options, cb) {
    this.sourceData = data.devices||[];
    this._buildResponse(options, cb);
};
HardwareDataSource.prototype.formatter = function (ix, item) {
    item.safeName = $safe(item.name);
};

var hardwareDataSource = new HardwareDataSource();

var DelegateDataSource = function (options) {
    AjaxDataSource.call(this, function () {
        return '/oauth/delegates?format=json'
    });
    this._columns = [
        {
            property: 'safeName',
            label: 'Name',
            sortable: true
        },
        {
            property: 'allowedString',
            label: 'Allowed Resources',
            sortable: false
        },
        {
            property: 'lastLogin',
            label: 'Last Login',
            sortable: true,
            width: 125
        }
    ];

    this._formatter = function (items) {
        $.each(items, function (index, item) {
            item.safeName = $safe(item.name);
            item.allowedString = item.allowed.map(function (a) {
                for (var i = 0; i < allRoles.length; i++) {
                    if (allRoles[i].value === a) {
                        return allRoles[i].text;
                    }
                }
                return a;
            }).join(', ');
        });
    }
};
DelegateDataSource.prototype = Object.create(AjaxDataSource.prototype);
DelegateDataSource.prototype.constructor = DelegateDataSource;
DelegateDataSource.prototype.success = function (response, options, cb) {
    this.sourceData = response.delegates;
    this._buildResponse(options, cb);
};
DelegateDataSource.prototype.formatter = function (index, item) {
    item.safeName = $safe(item.name);
    item.allowedString = item.allowed.map(function (a) {
        for (var i = 0; i < allRoles.length; i++) {
            if (allRoles[i].value === a) {
                return allRoles[i].text;
            }
        }
        return a;
    }).join(', ');
};

dataSource = new DelegateDataSource();

function showItem(d) {
    $('#delegateName').val(d.name);
    $('#delegatePassword').val(fakePassword);
    $('#delegateForm').data('bootstrapValidator').resetForm();
    $delegateFeatureSelect[0].selectize.setValue(d.allowed);
    $('#deleteDelegate').show();
    $('#delegateModal').modal();
}

function saveDelegate() {
    var needInsert = false;
    if (!selectedDelegate) {
        selectedDelegate = {};
        needInsert = true;
    }
    selectedDelegate.name = $('#delegateName').val();
    selectedDelegate.password = $('#delegatePassword').val();
    selectedDelegate.allowed = $delegateFeatureSelect[0].selectize.getValue().split(',');

    $('#progressAlert').attr('aria-hidden', 'true').css('display', 'none');
    $('#progressBar').css('width', 0).attr('aria-valuenow', 0);
    $('#progressModal').modal('show');

    selectedDelegate._csrf = _csrf;

    $.ajax({
        url: '/oauth/delegates',
        dataType: 'json',
        data: selectedDelegate,
        type: 'POST',
        cache: false,
        success: function (data) {
            if (!data || !data.success) {
                $('#progressError').html(data.message);
                $('#progressAlert').css('display', 'block').alert();
                $('#delegateForm').data('bootstrapValidator').resetForm();
            } else {
                $('#progressModal').modal('hide');
                setTimeout(function () {
                    $('#delegateModal').modal('hide');

                    if (needInsert) {
                        dataSource.sourceData.unshift(selectedDelegate);
                    }
                    $('#delegateGrid').repeater('render');

                    $('#delegateUrl').val(data.url);
                    setTimeout(function () {
                        $('#delegationUrlModal').modal();
                        $('#delegateUrl').focus();
                    }, 500);
                }, 500);
            }
        },
        error: function (xhr, type, error) {
            $('#progressError').html(error);
            $('#progressAlert').css('display', 'block').alert();
            $('#delegateForm').data('bootstrapValidator').resetForm();
        }
    });
}

$(document).ready(function () {
    $('#delegateGrid').repeater({
        dataSource: function (o, c) {
            dataSource.data(o, c);
        },
        defaultView: 'list',
        list_selectable: true,
        list_noItemsHTML: '<i>Delegation allows you to share a working link to various features on this site without sharing your actual PayPal login information.<br/><br/>You may delete or change the password of previous delegations at any time.</i>'
    });

    $('#delegateGrid').on('click', 'table>tbody>tr', function () {
        var $this = $(this);
        // Undo selection UI
        $this.removeClass('selected');
        $this.find('.repeater-list-check').remove();
        selectedDelegate = $(this).data("item_data");
        showItem(selectedDelegate);
    });

    $('#delegatePassword').on('click focusin', function() {
        if (this.value === fakePassword) {
            this.value = '';
        }
    });

    $('#delegatePassword').on('focusout', function () {
        if (this.value.length === 0 && selectedDelegate.id) {
            this.value = fakePassword;
        }
    })

    $('#addDelegate').on('click', function () {
        selectedDelegate = null;
        $('#deleteDelegate').hide();
        $('#delegateName').val("");
        $('#delegatePassword').val("");
        $('#delegateModal').modal();
    });

    $('#deleteDelegate').on('click', function () {
        $('#progressAlert').attr('aria-hidden', 'true').css('display', 'none');
        $('#progressBar').css('width', 0).attr('aria-valuenow', 0);
        $('#progressModal').modal('show');

        $.ajax({
            url: '/oauth/delegates/'+selectedDelegate.id,
            dataType: 'json',
            type: 'DELETE',
            cache: false,
            data: {_csrf:_csrf},
            success: function (data) {
                if (!data || !data.success) {
                    $('#progressError').html(data.message);
                    $('#progressAlert').css('display', 'block').alert();
                    $('#delegateForm').data('bootstrapValidator').resetForm();
                } else {
                    $('#progressModal').modal('hide');
                    $('#delegateModal').modal('hide');

                    dataSource.rawData.splice($.inArray(selectedDelegate, dataSource.rawData), 1);
                    selectedDelegate = null;
                    $('#delegateGrid').repeater('render');
                }
            },
            error: function (xhr, type, error) {
                $('#progressError').html(error);
                $('#progressAlert').css('display', 'block').alert();
                $('#delegateForm').data('bootstrapValidator').resetForm();
            }
        });
    });

    $delegateFeatureSelect = $('#delegateFeatures').selectize({
        delimiter: ',',
        persist: false,
        create: false,
        options: allRoles,
        openOnFocus: true,
        plugins: ['remove_button']
    });

    $('#delegateFeatures_div div.selectize-input').addClass('form-control');

    var bv = $('#delegateForm').bootstrapValidator({
        live: 'enabled',
        excluded: [],
        feedbackIcons: {
            valid: 'glyphicon glyphicon-ok',
            invalid: 'glyphicon glyphicon-remove',
            validating: 'glyphicon glyphicon-refresh'
        },
        fields: {
            delegateName: {
                validators: {
                    notEmpty: {
                        message: 'A name is required.'
                    }
                }
            },
            delegatePassword: {
                validators: {
                    notEmpty: {
                        message: 'A password is required.'
                    }
                }
            },
            delegateFeatures: {
                selector: '#delegateFeatures_div div.selectize-input input',
                validators: {
                    selectized: {
                        validator: 'notEmpty',
                        message: 'You must grant access to at least one feature.'
                    }
                }
            }
        }
    }).on('success.form.bv', function(e) {
        e.preventDefault();
        saveDelegate();
    });
    wireValidatedSelectize('delegateFeatures', bv);

    $('#sidebar').on('click', 'a', function (e) {
        e.preventDefault();
        if (!$(this).parent().hasClass('active')) {
            var view = $(this).data('view');
            $('#sidebar li').removeClass('active');
            $(this).parent().addClass('active');
            $('#main>div').hide();
            $('#'+view).show();
        }
    });

    /*** Hardware Interfaces ***/
    $('#hardwareGrid').repeater({
        dataSource: function (o, c) {
            return hardwareDataSource.data(o, c);
        },
        defaultView: 'list',
        list_selectable: true,
        list_noItemsHTML: '<i>You currently have no hardware interfaces configured.</i>'
    });

    $('#addHardware').on('click', function (e) {
        e.preventDefault();
        $('#hardwareModal').modal();
    });

    $('#addHardwareButton').on('click', function (e) {
        e.preventDefault();
        var l = Ladda.create(this);
        l.start();
        $.get('/devices/add?uuid='+encodeURIComponent($('#installationKey').val()))
            .done(function (data) {
                l.stop();
                console.log(data);
            })
            .fail(function (xhr, e) {
                alert("Failed! " + e.toString());
                l.stop();
            });
    });

    $('#hardwareGrid').on('click', 'table>tbody>tr', function () {
        var $this = $(this);
        // Undo selection UI
        $this.removeClass('selected');
        $this.find('.repeater-list-check').remove();
        selectedDevice = $(this).data("item_data");
        showDevice(selectedDevice);
    });

    $('#saveDeviceInfo').on('click', function (e) {
        e.preventDefault();
        var l = Ladda.create(this);
        l.start();
        $.post('/devices/preferences/' + selectedDevice._id,
            {name:$('#deviceName').val(),_csrf:_csrf})
            .done(function (data) {
                l.stop();
                selectedDevice.name = $('#deviceName').val();
                $('#hardwareGrid').repeater('render');
                $('#hardwareEditModal').modal('hide');
            })
            .fail(function (xhr, e) {
                alert("Failed! " + e.toString());
                l.stop();
            });
    });

    $('#hardwareEditModal').on('shown.bs.modal', function () {
        $('#deviceName').focus();
    });
});

function showDevice(d) {
    $('#deviceName').val(d.name);
    $('#deviceId').val(d.id);
    $('#deviceHost').val(d.host);
    $('#hardwareEditModal').modal();
}

