var LocationDataSource = function (options) {

    this._columns = [
        {
            property: 'imageTag',
            label: '<div class="glyphicon glyphicon-camera"></div>',
            sortable: false,
            className: 'pph-itemPhoto',
            width: 80
        },
        {
            property: 'safeInternalName',
            label: 'Internal Name',
            sortable: true
        },
        {
            property: 'nameAndAddr',
            sortProperty: 'name',
            label: 'Name and Address',
            sortable: true
        },
        {
            property: 'availability',
            label: 'Availability',
            sortable: true,
            width: 125,
            className: 'pph-openclose'
        },
        {
            property: 'map',
            label: 'Map',
            width: 160,
            className: 'pph-map'
        }
    ];

    this._formatter = function (items) {
        $.each(items, function (index, item) {
            // TODO not sure this is sufficient escaping even though it's coming from our server.
            item.imageTag = "<img src=\"" +
                (item.logoUrl || '/media/image_default_138.png').replace("\"", "") +
                "\" width=\"80\" height=\"80\"/>";
            var nameadd = [];
            nameadd.push($safe(item.name));
            if (item.address && item.address.line1) {
                nameadd.push($safe(item.address.line1));
            }
            if (item.address && item.address.city) {
                nameadd.push($safe(item.address.city + ", " + (item.address.state || "")));
            }
            item.nameAndAddr = nameadd.join("<br/>");
            item.safeInternalName = $safe(item.internalName);
            item.map = "<img src=\"" +
                "https://maps.googleapis.com/maps/api/staticmap?size=160x80&zoom=14&center=" +
                item.latitude + "," + item.longitude +
                "&markers=size:tiny%7Ccolor:blue%7C" + item.latitude + "," + item.longitude +
                "\" width=\"160\" height=\"80\"/>";
        });
    }
};

LocationDataSource.prototype = {

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
            $.ajax('/locations/api?format=json', {
                dataType: 'json',
                type: 'GET'
            }).done(function (response) {
                model = response;
                // Make sure we have the main containers
                self.rawData = response.locations;
                self._buildResponse(options, callback);
            });
        }
    }
};

var dataSource = new LocationDataSource();
var builtInButtons = [
    {
        label: 'Bid',
        value: 'BID'
    },
    {
        label: 'Donate',
        value: 'DONATE'
    },
    {
        label: 'Order',
        value: 'ORDER'
    },
    {
        label: 'Schedule',
        value: 'SCHEDULE'
    },
    {
        label: 'View Bill',
        value: 'VIEWBILL'
    }
];
var selectedLocation = null, locationIsAvailable, locationIsMobile;
var locAddr, locCoords, locButton;

function showLocation(s) {
    $('#locationForm').data('bootstrapValidator').resetForm();
    $('#locationImage').attr("src", s.logoUrl ? s.logoUrl : '/media/image_default_138.png');
    $('#locationUrl').val(s.logoUrl);
    $('#locationInternalName').val(s.internalName);
    $('#locationMessage').val(s.displayMessage);
    $('#locationName').val(s.name);
    $('#locationPhone').val(s.phoneNumber);
    $('#locationTabUrl').val(s.tabExtensionUrl);
    $('#locationTabDuration').val(s.tabDuration);
    if (s.formFactors && s.formFactors.mobileDevice && s.formFactors.mobileDevice.experience &&
        s.formFactors.mobileDevice.experience.toLowerCase() == "paycode") {
        if (s.tabType == "none") {
            $('#locationFormFactor button span.value').text($('#locationPayCode').text());
        } else {
            $('#locationFormFactor button span.value').text($('#locationFFBoth').text());
        }
    } else {
        $('#locationFormFactor button span.value').text($('#locationByFace').text());
    }
    if (s.tabExtensionButtonType && s.tabExtensionButtonType.toLowerCase() === 'free_form_text') {
        $('#locationButton')[0].selectize.addOption({label:s.tabExtensionButtonText,value:s.tabExtensionButtonText});
        $('#locationButton')[0].selectize.setValue(s.tabExtensionButtonText);
    } else if (s.tabExtensionButtonType) {
        $('#locationButton')[0].selectize.setValue(s.tabExtensionButtonType.toUpperCase());
    } else {
        $('#locationButton')[0].selectize.setValue('');
    }
    if (s.tabExtensionUrl && s.tabExtensionUrl.length) {
        $('#locationButton_formgroup').show();
    } else {
        $('#locationButton_formgroup').hide();
    }
    $('#locationModal').modal();
    locAddr = $.extend({}, s.address);
    locCoords = {
        lng: s.longitude,
        lat: s.latitude
    };
    setAvailability(s.availability.toLowerCase() === 'open');
    setIsMobile(s.mobility.toLowerCase() !== 'fixed');
    if (s.longitude && s.latitude && map) {
        var geolocation = new google.maps.LatLng(
            selectedLocation.latitude, selectedLocation.longitude);
        map.setCenter(geolocation);
    }
}

function setIsMobile(isMobile) {
    locationIsMobile = isMobile;
    $('#locationType button span.value').text($(isMobile ? '#locationMobile' : '#locationFixed').text());
    if (isMobile) {
        if (locCoords && locCoords.lat && locCoords.lng) {
            $('#locationLocation').text(locCoords.lng + "," + locCoords.lat);
        } else {
            $('#locationLocation').text("Not Yet Specified")
        }
    } else {
        if (locAddr) {
            $('#locationLocation').text(
                [
                    locAddr.line1 ? locAddr.line1 : "",
                    locAddr.line1 ? ", " : "",
                    locAddr.line2 ? locAddr.line2 : "",
                    locAddr.line2 ? ", " : "",
                    locAddr.city,
                    ", ",
                    locAddr.state,
                    locAddr.postalCode ? ", " : "",
                    locAddr.postalCode ? locAddr.postalCode : ""
                ].join('')
            );
        } else {
            $('#locationLocation').text("Not Yet Specified")
        }
    }
}

function setAvailability(isOpen) {
    locationIsAvailable = isOpen;
    var btn = $('#locationAvailability button');
    btn.addClass(isOpen ? "btn-success" : "btn-danger").removeClass(isOpen ? "btn-danger" : "btn-success");
    $('#locationAvailability button span.value').text($(isOpen ? '#locationOpen' : '#locationClosed').text());
}

function saveLocation() {
    if (!selectedLocation) {
        selectedLocation = {};
        dataSource.rawData = dataSource.rawData || [];
        dataSource.rawData.push(selectedLocation);
    }
    selectedLocation.gratuityType = $('#locationTips').is(':checked') ? "standard" : "none";
    selectedLocation.address = locAddr;
    selectedLocation.longitude = parseFloat(locCoords.lng);
    selectedLocation.latitude = parseFloat(locCoords.lat);
    selectedLocation.availability = locationIsAvailable ? "open" : "closed";
    selectedLocation.mobility = locationIsMobile ? "mobile" : "fixed";
    selectedLocation.name = $('#locationName').val();
    selectedLocation.internalName = $('#locationInternalName').val();
    selectedLocation.displayMessage = $('#locationMessage').val();
    selectedLocation.logoUrl = $('#locationUrl').val();
    selectedLocation.phoneNumber = $('#locationPhone').val();
    selectedLocation.tabDuration = parseInt($('#locationTabDuration').val());
    var ttypeText = $('#locationFormFactor button span.value').text();
    if (ttypeText == $('#locationPayCode').text()) {
        selectedLocation.formFactors = {mobileDevice:{experience:'PAYCODE'}};
        selectedLocation.tabType = 'none';
    } else if (ttypeText == $('#locationByFace').text()) {
        delete selectedLocation.formFactors;
        selectedLocation.tabType = 'standard';
    } else {
        selectedLocation.formFactors = {mobileDevice:{experience:'PAYCODE'}};
        selectedLocation.tabType = 'standard';
    }
    if (selectedLocation.displayMessage === '') {
        delete selectedLocation.displayMessage;
    }
    var button = $('#locationButton').val();
    if ($('#locationTabUrl').val().length) {
        selectedLocation.tabExtensionType = 'postOpen';
        selectedLocation.tabExtensionUrl = $('#locationTabUrl').val();
    } else {
        delete selectedLocation.tabExtensionUrl;
        selectedLocation.tabExtensionType = 'none';
        delete selectedLocation.tabExtensionButtonType;
        /* You can't have a button without an extension */
        button = null;
    }
    if (button && button.length) {
        var found = false;
        for (var bi = 0; bi < builtInButtons.length; bi++) {
            if (builtInButtons[bi].value.toLowerCase() == button.toLowerCase()) {
                selectedLocation.tabExtensionButtonType = builtInButtons[bi].value;
                delete selectedLocation.tabExtensionButtonText;
                found = true;
                break;
            }
        }
        if (!found) {
            selectedLocation.tabExtensionButtonType = "FREE_FORM_TEXT";
            selectedLocation.tabExtensionButtonText = button;
        }
    } else {
        delete selectedLocation.tabExtensionButtonType;
        delete selectedLocation.tabExtensionButtonText;
    }

    showProgress();
    $.ajax({
        dataType: 'json',
        data: {model: JSON.stringify(selectedLocation), _csrf: _csrf},
        url: '/locations/api',
        type: 'POST',
        cache: false,
        success: function (data) {
            if (data && !data.success) {
                if (data.message) {
                    $('#progressError').html(data.message);
                } else if (data.errorCode) {
                    var msg = 'Server error ' + data.errorCode;
                    if (data.correlationId) {
                        msg += ' (Case #' + data.correlationId + ')';
                    }
                    $('#progressError').html(msg);
                }
                $('#progressAlert').css('display', 'block').alert();
                return;
            }
            $('#progressBar').css('width', 100).attr('aria-valuenow', 100);
            $('#progressModal').modal('hide');
            $('#locationModal').modal('hide');
            $('#locationGrid').repeater('render');
        },
        error: function (xhr, type, error) {
            $('#progressError').html(error);
            $('#progressAlert').css('display', 'block').alert();
        }
    });
}

function showProgress() {
    $('#progressAlert').attr('aria-hidden', 'true').css('display', 'none');
    $('#progressBar').css('width', 0).attr('aria-valuenow', 0);
    $('#progressModal').modal('show');
}

function saveLocationDetail() {
    locAddr = {};
    locAddr.line1 = $('#locAddress1').val();
    locAddr.line2 = $('#locAddress2').val();
    locAddr.city = $('#locCity').val();
    locAddr.state = $('#locState').val();
    locAddr.postalCode = $('#locZip').val();
    locAddr.country = $('#locCountry').val();
    locCoords = {};
    var coords = $('#locGps').val().split(',');
    locCoords.lng = coords[0];
    locCoords.lat = coords[1];
    $('#googleModal').modal('hide');
}

var mapInit, map;
function initializeMaps() {
    if (mapInit) {
        return;
    }
    mapInit = true;

    var mapOptions = {
        center: new google.maps.LatLng(42.3560716, -71.0527295),
        zoom: 14
    };
    map = new google.maps.Map(document.getElementById('map-canvas'),
        mapOptions);

    var input = /** @type {HTMLInputElement} */(
        document.getElementById('pac-input'));

    var types = document.getElementById('type-selector');
    map.controls[google.maps.ControlPosition.TOP_LEFT].push(input);
    map.controls[google.maps.ControlPosition.TOP_LEFT].push(types);

    var autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.bindTo('bounds', map);

    if (selectedLocation && selectedLocation.latitude && selectedLocation.longitude) {
        var geolocation = new google.maps.LatLng(
            selectedLocation.latitude, selectedLocation.longitude);
        map.setCenter(geolocation);
        autocomplete.setBounds(new google.maps.LatLngBounds(geolocation,
            geolocation));
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (position) {
            var geolocation = new google.maps.LatLng(
                position.coords.latitude, position.coords.longitude);
            map.setCenter(geolocation);
            autocomplete.setBounds(new google.maps.LatLngBounds(geolocation,
                geolocation));
        });
    }

    var infowindow = new google.maps.InfoWindow();
    var marker = new google.maps.Marker({
        map: map,
        anchorPoint: new google.maps.Point(0, -29)
    });

    var componentForm = {
        street_number: 'short_name',
        route: 'long_name',
        locality: 'long_name',
        administrative_area_level_1: 'short_name',
        country: 'short_name',
        postal_code: 'short_name'
    };

    google.maps.event.addListener(autocomplete, 'place_changed', function () {
        infowindow.close();
        marker.setVisible(false);
        var place = autocomplete.getPlace();
        console.log(place);
        if (!place.geometry) {
            return;
        }

        // If the place has a geometry, then present it on a map.
        if (place.geometry.viewport) {
            map.fitBounds(place.geometry.viewport);
        } else {
            map.setCenter(place.geometry.location);
            map.setZoom(17);  // Why 17? Because it looks good.
        }
        marker.setIcon(/** @type {google.maps.Icon} */({
            url: place.icon,
            size: new google.maps.Size(71, 71),
            origin: new google.maps.Point(0, 0),
            anchor: new google.maps.Point(17, 34),
            scaledSize: new google.maps.Size(35, 35)
        }));
        marker.setPosition(place.geometry.location);
        marker.setVisible(true);

        var address = '', namedAddress = {};
        if (place.address_components) {
            address = [
                (place.address_components[0] && place.address_components[0].short_name || ''),
                (place.address_components[1] && place.address_components[1].short_name || ''),
                (place.address_components[2] && place.address_components[2].short_name || '')
            ].join(' ');

            // Get each component of the address from the place details
            // and fill the corresponding field on the form.
            for (var i = 0; i < place.address_components.length; i++) {
                var addressType = place.address_components[i].types[0];
                if (componentForm[addressType]) {
                    var val = place.address_components[i][componentForm[addressType]];
                    namedAddress[addressType] = val;
                }
            }
        }

        $('#locZip').val(namedAddress.postal_code);
        if (namedAddress.street_number && namedAddress.route) {
            $('#locAddress1').val(namedAddress.street_number + " " + namedAddress.route);
        } else if (namedAddress.route) {
            $('#locAddress1').val(namedAddress.route);
        }
        $('#locAddress2').val('');
        $('#locCity').val(namedAddress.locality);
        $('#locState').val(namedAddress.administrative_area_level_1);
        $('#locCountry').val(namedAddress.country);
        if (place.geometry && place.geometry.location) {
            $('#locGps').val(place.geometry.location.lng() + "," + place.geometry.location.lat());
        }

        $('#locationDetailForm').data('bootstrapValidator').validate();

        infowindow.setContent('<div><strong>' + place.name + '</strong><br>' + address);
        infowindow.open(map, marker);
    });

    // Sets a listener on a radio button to change the filter type on Places
    // Autocomplete.
    function setupClickListener(id, types) {
        var radioButton = document.getElementById(id);
        google.maps.event.addDomListener(radioButton, 'click', function () {
            autocomplete.setTypes(types);
        });
    }

    setupClickListener('changetype-all', []);
    setupClickListener('changetype-establishment', ['establishment']);
    setupClickListener('changetype-geocode', ['geocode']);
}

$(document).ready(function () {
    $('#locationGrid').repeater({
        dataSource: function (o, c) {
            dataSource.data(o, c);
        },
        defaultView: 'list',
        list_selectable: true
    });

    $('#locationGrid').on('click', 'table>tbody>tr', function () {
        var $this = $(this);
        // Undo selection UI
        $this.removeClass('selected');
        $this.find('.repeater-list-check').remove();
        selectedLocation = $(this).data("item_data");
        showLocation(selectedLocation);
    });

    $('#addLocation').on('click', function () {
        selectedLocation = null;
        locAddr = null;
        locCoords = null;
        locationIsAvailable = locationIsMobile = false;
        showLocation({});
    });

    $('#deleteLocation').on('click', function () {
        if (!selectedLocation) {
            /* Nothing to do here, not a saved location */
            $('#locationModal').modal();
            return;
        }
        showProgress();
        $.ajax({
            dataType: 'json',
            data: {_csrf: _csrf},
            url: '/locations/api/' + selectedLocation.id,
            type: 'DELETE',
            cache: false,
            success: function (data) {
                if (data && data.status.toLowerCase() !== 'deleted') {
                    $('#progressError').html(data.message);
                    $('#progressAlert').css('display', 'block').alert();
                    return;
                }
                dataSource.rawData.splice($.inArray(selectedLocation, dataSource.rawData), 1);
                $('#locationGrid').repeater('render');
                $('#progressBar').css('width', 100).attr('aria-valuenow', 100);
                $('#progressModal').modal('hide');
                $('#locationModal').modal('hide');
            },
            error: function (xhr, type, error) {
                $('#progressError').html(error);
                $('#progressAlert').css('display', 'block').alert();
            }
        });
    });

    $('#locationType').on('click', 'a', function () {
        setIsMobile(this.id === 'locationMobile');
    });

    $('#locationFormFactor').on('click', 'a', function () {
        $('#locationFormFactor button span.value').text($(this).text());
    });

    $('#locationAvailability').on('click', 'a', function () {
        setAvailability(this.id === "locationOpen");
    });

    $.fn.bootstrapValidator.validators.uniqueInternalName = {
        html5Attributes: {
            message: 'message',
            field: 'field',
            check_only_for: 'check_only_for'
        },
        validate: function (validator, $field, options) {
            var value = $field.val();
            if (!dataSource.rawData || !dataSource.rawData.length) {
                return true;
            }
            for (var i = 0; i < dataSource.rawData.length; i++) {
                if (dataSource.rawData[i] !== selectedLocation && dataSource.rawData[i].internalName.toLowerCase() === value.toLowerCase()) {
                    return false;
                }
            }
            return true;
        }
    };

    $.fn.bootstrapValidator.validators.lngLat = {
        html5Attributes: {
            message: 'message',
            field: 'field',
            check_only_for: 'check_only_for'
        },
        validate: function (validator, $field, options) {
            var value = $field.val(), lngLat;
            if (!value.length || (lngLat = value.split(',')).length != 2) {
                return false;
            }
            var lng = parseFloat(lngLat[0]), lat = parseFloat(lngLat[1]);
            if (lng > 180 || lng < -180 || lat > 90 || lat < -90) {
                return false;
            }
            if (map) {
                var geolocation = new google.maps.LatLng(lat, lng);
                map.setCenter(geolocation);
            }
            return true;
        }
    };

    $('#locationForm').bootstrapValidator({
        live: 'enabled',
        feedbackIcons: {
            valid: 'glyphicon glyphicon-ok',
            invalid: 'glyphicon glyphicon-remove',
            validating: 'glyphicon glyphicon-refresh'
        },
        fields: {
            locationName: {
                validators: {
                    notEmpty: {
                        message: 'A name is required.'
                    }
                }
            },
            locationInternalName: {
                validators: {
                    notEmpty: {
                        message: 'An internal name is required.'
                    },
                    uniqueInternalName: {
                        message: 'The internal name must be unique among all your locations.'
                    }
                }
            },
            locationTabDuration: {
                validators: {
                    between: {
                        min: 15,
                        max: 360,
                        message: 'The tab duration must be between 15 and 360 minutes.'
                    }
                }
            }
        }
    }).on('success.form.bv', function (e) {
        e.preventDefault();
        saveLocation();
    });

    $('#locationDetailForm').bootstrapValidator({
        live: 'enabled',
        feedbackIcons: {
            valid: 'glyphicon glyphicon-ok',
            invalid: 'glyphicon glyphicon-remove',
            validating: 'glyphicon glyphicon-refresh'
        },
        fields: {
            locGps: {
                validators: {
                    lngLat: {
                        message: 'Enter valid longitude,latitude'
                    }
                }
            },
            locCity: {
                validators: {
                    notEmpty: {
                        message: 'A city is required.'
                    }
                }
            },
            locLine1: {
                validators: {
                    notEmpty: {
                        message: 'An address is required.'
                    }
                }
            },
            locCountry: {
                validators: {
                    notEmpty: {
                        message: 'A valid country is required.'
                    }
                }
            }
        }
    }).on('success.form.bv', function (e) {
        e.preventDefault();
        saveLocationDetail();
    });

    $('#locationUpdate').on('click', function () {
        var address = locAddr || {};
        $('#locZip').val(address.postalCode);
        $('#locAddress1').val(address.line1);
        $('#locAddress2').val(address.line2);
        $('#locCity').val(address.city);
        $('#locState').val(address.state);
        $('#locCountry')[0].selectize.setValue(address.country);
        if (locCoords && locCoords.lat && locCoords.lng) {
            $('#locGps').val(locCoords.lng + "," + locCoords.lat);
        } else {
            $('#locGps').val("");
        }
        $('#locationDetailForm').data('bootstrapValidator').validate();
        $('#googleModal').modal();
    });

    $('#locCountry').selectize({
        create: false,
        sortField: 'name',
        valueField: 'code',
        maxItems: 1,
        searchField: ['name', 'code'],
        render: {
            item: function (d, e) {
                return ['<div class="item">', e(d.code), "</div>"].join('');
            },
            option: function (d, e) {
                return ['<div class="option"><b>', e(d.name), '</b>&nbsp;<span>', e(d.code), "</span></div>"].join('');
            }
        },
        options: countryCodes
    });

    $('#locationButton').selectize({
        create: function (v) {
            return {
                label: v,
                value: v
            };
        },
        maxItems: 1,
        options: builtInButtons,
        labelField: 'label',
        valueField: 'value',
        searchField: ['label']
    });

    $('#locationModal')
        .on('change', '.btn-file :file', function () {
            var input = $(this),
                numFiles = input.get(0).files ? input.get(0).files.length : 1,
                label = input.val().replace(/\\/g, '/').replace(/.*\//, '');
            showProgress();

            var formData = new FormData();
            formData.append('imageupload', $("#imageupload")[0].files[0]);
            uploadSomething('/locations/image', formData, function (err, rz) {
                $('#locationImage').attr("src", rz.url);
                $('#locationUrl').val(rz.url);
            });
        });
    $('#locationTabUrl').on('change', function () {
        var t = $(this), v = t.val(), lb = $('#locationButton_formgroup');
        if (v && v.length && !lb.is(":visible")) {
            lb.slideDown();
        } else if ((!v || v.length === 0) && lb.is(':visible')) {
            lb.slideUp();
        }
    });

    $('#googleModal').on('shown.bs.modal', initializeMaps);
});

var countryCodes = [
    {
        code: "AF",
        name: "Afghanistan"
    },
    {
        code: "AL",
        name: "Albania"
    },
    {
        code: "DZ",
        name: "Algeria"
    },
    {
        code: "AS",
        name: "American Samoa"
    },
    {
        code: "AD",
        name: "Andorra"
    },
    {
        code: "AO",
        name: "Angola"
    },
    {
        code: "AI",
        name: "Anguilla"
    },
    {
        code: "AQ",
        name: "Antarctica"
    },
    {
        code: "AG",
        name: "Antigua and Barbuda"
    },
    {
        code: "AR",
        name: "Argentina"
    },
    {
        code: "AM",
        name: "Armenia"
    },
    {
        code: "AW",
        name: "Aruba"
    },
    {
        code: "AU",
        name: "Australia"
    },
    {
        code: "AT",
        name: "Austria"
    },
    {
        code: "AZ",
        name: "Azerbaijan"
    },
    {
        code: "BS",
        name: "Bahamas"
    },
    {
        code: "BH",
        name: "Bahrain"
    },
    {
        code: "BD",
        name: "Bangladesh"
    },
    {
        code: "BB",
        name: "Barbados"
    },
    {
        code: "BY",
        name: "Belarus"
    },
    {
        code: "BE",
        name: "Belgium"
    },
    {
        code: "BZ",
        name: "Belize"
    },
    {
        code: "BJ",
        name: "Benin"
    },
    {
        code: "BM",
        name: "Bermuda"
    },
    {
        code: "BT",
        name: "Bhutan"
    },
    {
        code: "BO",
        name: "Bolivia, Plurinational State Of"
    },
    {
        code: "BQ",
        name: "Bonaire, Sint Eustatius and Saba"
    },
    {
        code: "BA",
        name: "Bosnia and Herzegovina"
    },
    {
        code: "BW",
        code: "IO",
        name: "British Indian Ocean Territory"
    },
    {
        code: "BN",
        name: "Brunei Darussalam"
    },
    {
        code: "BG",
        name: "Bulgaria"
    },
    {
        code: "BF",
        name: "Burkina Faso"
    },
    {
        code: "BI",
        name: "Burundi"
    },
    {
        code: "KH",
        name: "Cambodia"
    },
    {
        code: "CM",
        name: "Cameroon"
    },
    {
        code: "CA",
        name: "Canada"
    },
    {
        code: "CV",
        name: "Cape Verde"
    },
    {
        code: "KY",
        name: "Cayman Islands"
    },
    {
        code: "CF",
        name: "Central African Republic"
    },
    {
        code: "TD",
        name: "Chad"
    },
    {
        code: "CL",
        name: "Chile"
    },
    {
        code: "CN",
        name: "China"
    },
    {
        code: "CX",
        name: "Christmas Island"
    },
    {
        code: "CC",
        name: "Cocos (Keeling) Islands"
    },
    {
        code: "CO",
        name: "Colombia"
    },
    {
        code: "KM",
        name: "Comoros"
    },
    {
        code: "CG",
        name: "Congo"
    },
    {
        code: "CD",
        name: "Congo The Democratic Republic Of The"
    },
    {
        code: "CK",
        name: "Cook Islands"
    },
    {
        code: "CR",
        name: "Costa Rica"
    },
    {
        code: "HR",
        name: "Croatia"
    },
    {
        code: "CU",
        name: "Cuba"
    },
    {
        code: "CW",
        name: "Curaçao"
    },
    {
        code: "CY",
        name: "Cyprus"
    },
    {
        code: "CZ",
        name: "Czech Republic"
    },
    {
        code: "CI",
        name: "Côte D\'Ivoire"
    },
    {
        code: "DK",
        name: "Denmark"
    },
    {
        code: "DJ",
        name: "Djibouti"
    },
    {
        code: "DM",
        name: "Dominica"
    },
    {
        code: "DO",
        name: "Dominican Republic"
    },
    {
        code: "EC",
        name: "Ecuador"
    },
    {
        code: "EG",
        name: "Egypt"
    },
    {
        code: "SV",
        name: "El Salvador"
    },
    {
        code: "GQ",
        name: "Equatorial Guinea"
    },
    {
        code: "ER",
        name: "Eritrea"
    },
    {
        code: "EE",
        name: "Estonia"
    },
    {
        code: "ET",
        name: "Ethiopia"
    },
    {
        code: "FK",
        name: "Falkland Islands  (Malvinas)"
    },
    {
        code: "FO",
        name: "Faroe Islands"
    },
    {
        code: "FJ",
        name: "Fiji"
    },
    {
        code: "FI",
        name: "Finland"
    },
    {
        code: "FR",
        name: "France"
    },
    {
        code: "GF",
        name: "French Guiana"
    },
    {
        code: "PF",
        name: "French Polynesia"
    },
    {
        code: "TF",
        name: "French Southern Territories"
    },
    {
        code: "GA",
        name: "Gabon"
    },
    {
        code: "GM",
        name: "Gambia"
    },
    {
        code: "GE",
        name: "Georgia"
    },
    {
        code: "DE",
        name: "Germany"
    },
    {
        code: "GH",
        name: "Ghana"
    },
    {
        code: "GI",
        name: "Gibraltar"
    },
    {
        code: "GR",
        name: "Greece"
    },
    {
        code: "GL",
        name: "Greenland"
    },
    {
        code: "GD",
        name: "Grenada"
    },
    {
        code: "GP",
        name: "Guadeloupe"
    },
    {
        code: "GU",
        name: "Guam"
    },
    {
        code: "GT",
        name: "Guatemala"
    },
    {
        code: "GG",
        name: "Guernsey"
    },
    {
        code: "GN",
        name: "Guinea"
    },
    {
        code: "GW",
        name: "Guinea-Bissau"
    },
    {
        code: "GY",
        name: "Guyana"
    },
    {
        code: "HT",
        name: "Haiti"
    },
    {
        code: "HM",
        name: "Heard Island and McDonald Islands"
    },
    {
        code: "VA",
        name: "Holy See (Vatican City State)"
    },
    {
        code: "HN",
        name: "Honduras"
    },
    {
        code: "HK",
        name: "Hong Kong"
    },
    {
        code: "HU",
        name: "Hungary"
    },
    {
        code: "IS",
        name: "Iceland"
    },
    {
        code: "IN",
        name: "India"
    },
    {
        code: "ID",
        name: "Indonesia"
    },
    {
        code: "IR",
        name: "Iran, Islamic Republic Of"
    },
    {
        code: "IQ",
        name: "Iraq"
    },
    {
        code: "IE",
        name: "Ireland"
    },
    {
        code: "IM",
        name: "Isle of Man"
    },
    {
        code: "IL",
        name: "Israel"
    },
    {
        code: "IT",
        name: "Italy"
    },
    {
        code: "JM",
        name: "Jamaica"
    },
    {
        code: "JP",
        name: "Japan"
    },
    {
        code: "JE",
        name: "Jersey"
    },
    {
        code: "JO",
        name: "Jordan"
    },
    {
        code: "KZ",
        name: "Kazakhstan"
    },
    {
        code: "KE",
        name: "Kenya"
    },
    {
        code: "KI",
        name: "Kiribati"
    },
    {
        code: "KP",
        name: "Korea, Democratic People\'s Republic Of"
    },
    {
        code: "KR",
        name: "Korea, Republic of"
    },
    {
        code: "KW",
        name: "Kuwait"
    },
    {
        code: "KG",
        name: "Kyrgyzstan"
    },
    {
        code: "LA",
        name: "Lao People\'s Democratic Republic"
    },
    {
        code: "LV",
        name: "Latvia"
    },
    {
        code: "LB",
        name: "Lebanon"
    },
    {
        code: "LS",
        name: "Lesotho"
    },
    {
        code: "LR",
        name: "Liberia"
    },
    {
        code: "LY",
        name: "Libya"
    },
    {
        code: "LI",
        name: "Liechtenstein"
    },
    {
        code: "LT",
        name: "Lithuania"
    },
    {
        code: "LU",
        name: "Luxembourg"
    },
    {
        code: "MO",
        name: "Macao"
    },
    {
        code: "MK",
        name: "Macedonia, the Former Yugoslav Republic Of"
    },
    {
        code: "MG",
        name: "Madagascar"
    },
    {
        code: "MW",
        name: "Malawi"
    },
    {
        code: "MY",
        name: "Malaysia"
    },
    {
        code: "MV",
        name: "Maldives"
    },
    {
        code: "ML",
        name: "Mali"
    },
    {
        code: "MT",
        name: "Malta"
    },
    {
        code: "MH",
        name: "Marshall Islands"
    },
    {
        code: "MQ",
        name: "Martinique"
    },
    {
        code: "MR",
        name: "Mauritania"
    },
    {
        code: "MU",
        name: "Mauritius"
    },
    {
        code: "YT",
        name: "Mayotte"
    },
    {
        code: "MX",
        name: "Mexico"
    },
    {
        code: "FM",
        name: "Micronesia, Federated States Of"
    },
    {
        code: "MD",
        name: "Moldova, Republic of"
    },
    {
        code: "MC",
        name: "Monaco"
    },
    {
        code: "MN",
        name: "Mongolia"
    },
    {
        code: "ME",
        name: "Montenegro"
    },
    {
        code: "MS",
        name: "Montserrat"
    },
    {
        code: "MA",
        name: "Morocco"
    },
    {
        code: "MZ",
        name: "Mozambique"
    },
    {
        code: "MM",
        name: "Myanmar"
    },
    {
        code: "NA",
        name: "Namibia"
    },
    {
        code: "NR",
        name: "Nauru"
    },
    {
        code: "NP",
        name: "Nepal"
    },
    {
        code: "NL",
        name: "Netherlands"
    },
    {
        code: "NC",
        name: "New Caledonia"
    },
    {
        code: "NZ",
        name: "New Zealand"
    },
    {
        code: "NI",
        name: "Nicaragua"
    },
    {
        code: "NE",
        name: "Niger"
    },
    {
        code: "NG",
        name: "Nigeria"
    },
    {
        code: "NU",
        name: "Niue"
    },
    {
        code: "NF",
        name: "Norfolk Island"
    },
    {
        code: "MP",
        name: "Northern Mariana Islands"
    },
    {
        code: "NO",
        name: "Norway"
    },
    {
        code: "OM",
        name: "Oman"
    },
    {
        code: "PK",
        name: "Pakistan"
    },
    {
        code: "PW",
        name: "Palau"
    },
    {
        code: "PS",
        name: "Palestinian Territory, Occupied"
    },
    {
        code: "PA",
        name: "Panama"
    },
    {
        code: "PG",
        name: "Papua New Guinea"
    },
    {
        code: "PY",
        name: "Paraguay"
    },
    {
        code: "PE",
        name: "Peru"
    },
    {
        code: "PH",
        name: "Philippines"
    },
    {
        code: "PN",
        name: "Pitcairn"
    },
    {
        code: "PL",
        name: "Poland"
    },
    {
        code: "PT",
        name: "Portugal"
    },
    {
        code: "PR",
        name: "Puerto Rico"
    },
    {
        code: "QA",
        name: "Qatar"
    },
    {
        code: "RO",
        name: "Romania"
    },
    {
        code: "RU",
        name: "Russian Federation"
    },
    {
        code: "RW",
        name: "Rwanda"
    },
    {
        code: "RE",
        name: "Réunion"
    },
    {
        code: "BL",
        name: "Saint Barthélemy"
    },
    {
        code: "SH",
        name: "Saint Helena, Ascension and Tristan Da Cunha"
    },
    {
        code: "KN",
        name: "Saint Kitts And Nevis"
    },
    {
        code: "LC",
        name: "Saint Lucia"
    },
    {
        code: "MF",
        name: "Saint Martin (French Part)"
    },
    {
        code: "PM",
        name: "Saint Pierre And Miquelon"
    },
    {
        code: "VC",
        name: "Saint Vincent And The Grenadines"
    },
    {
        code: "WS",
        name: "Samoa"
    },
    {
        code: "SM",
        name: "San Marino"
    },
    {
        code: "ST",
        name: "Sao Tome and Principe"
    },
    {
        code: "SA",
        name: "Saudi Arabia"
    },
    {
        code: "SN",
        name: "Senegal"
    },
    {
        code: "RS",
        name: "Serbia"
    },
    {
        code: "SC",
        name: "Seychelles"
    },
    {
        code: "SL",
        name: "Sierra Leone"
    },
    {
        code: "SG",
        name: "Singapore"
    },
    {
        code: "SX",
        name: "Sint Maarten (Dutch part)"
    },
    {
        code: "SK",
        name: "Slovakia"
    },
    {
        code: "SI",
        name: "Slovenia"
    },
    {
        code: "SB",
        name: "Solomon Islands"
    },
    {
        code: "SO",
        name: "Somalia"
    },
    {
        code: "ZA",
        name: "South Africa"
    },
    {
        code: "GS",
        name: "South Georgia and the South Sandwich Islands"
    },
    {
        code: "SS",
        name: "South Sudan"
    },
    {
        code: "ES",
        name: "Spain"
    },
    {
        code: "LK",
        name: "Sri Lanka"
    },
    {
        code: "SD",
        name: "Sudan"
    },
    {
        code: "SR",
        name: "Suriname"
    },
    {
        code: "SJ",
        name: "Svalbard And Jan Mayen"
    },
    {
        code: "SZ",
        name: "Swaziland"
    },
    {
        code: "SE",
        name: "Sweden"
    },
    {
        code: "CH",
        name: "Switzerland"
    },
    {
        code: "SY",
        name: "Syrian Arab Republic"
    },
    {
        code: "TW",
        name: "Taiwan, Province Of China"
    },
    {
        code: "TJ",
        name: "Tajikistan"
    },
    {
        code: "TZ",
        name: "Tanzania, United Republic of"
    },
    {
        code: "TH",
        name: "Thailand"
    },
    {
        code: "TL",
        name: "Timor-Leste"
    },
    {
        code: "TG",
        name: "Togo"
    },
    {
        code: "TK",
        name: "Tokelau"
    },
    {
        code: "TO",
        name: "Tonga"
    },
    {
        code: "TT",
        name: "Trinidad and Tobago"
    },
    {
        code: "TN",
        name: "Tunisia"
    },
    {
        code: "TR",
        name: "Turkey"
    },
    {
        code: "TM",
        name: "Turkmenistan"
    },
    {
        code: "TC",
        name: "Turks and Caicos Islands"
    },
    {
        code: "TV",
        name: "Tuvalu"
    },
    {
        code: "UG",
        name: "Uganda"
    },
    {
        code: "UA",
        name: "Ukraine"
    },
    {
        code: "AE",
        name: "United Arab Emirates"
    },
    {
        code: "GB",
        name: "United Kingdom"
    },
    {
        code: "US",
        name: "United States"
    },
    {
        code: "UM",
        name: "United States Minor Outlying Islands"
    },
    {
        code: "UY",
        name: "Uruguay"
    },
    {
        code: "UZ",
        name: "Uzbekistan"
    },
    {
        code: "VU",
        name: "Vanuatu"
    },
    {
        code: "VE",
        name: "Venezuela, Bolivarian Republic of"
    },
    {
        code: "VN",
        name: "Viet Nam"
    },
    {
        code: "VG",
        name: "Virgin Islands, British"
    },
    {
        code: "VI",
        name: "Virgin Islands, U.S."
    },
    {
        code: "WF",
        name: "Wallis and Futuna"
    },
    {
        code: "EH",
        name: "Western Sahara"
    },
    {
        code: "YE",
        name: "Yemen"
    },
    {
        code: "ZM",
        name: "Zambia"
    },
    {
        code: "ZW",
        name: "Zimbabwe"
    },
    {
        code: "AX",
        name: "Åland Islands"
    }
];
