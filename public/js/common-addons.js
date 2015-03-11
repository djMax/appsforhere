if (typeof Object.create !== 'function') {
    Object.create = function (o) {
        function F() {
        }

        F.prototype = o;
        return new F();
    };
}

function uploadSomething(url, formData, cb) {
    $('#progressAlert').attr('aria-hidden', 'true').css('display', 'none');
    $('#progressBar').css('width', 0).attr('aria-valuenow', 0);
    $('#progressModal').modal('show');
    formData.append('_csrf', _csrf);
    $.ajax({
        url: url,
        type: 'POST',
        xhr: function () {
            var myXhr = $.ajaxSettings.xhr();
            if (myXhr.upload) { /* Check if upload property exists */
                myXhr.upload.addEventListener('progress', function (e) {
                    $('#progressBar').css('width', parseInt(e.loaded * 100 / e.total)).attr('aria-valuenow', parseInt(e.loaded * 100 / e.total));
                }, false);
                /* For handling the progress of the upload */
            }
            return myXhr;
        },
        beforeSend: function () {
        },
        success: function (data) {
            $('#progressBar').css('width', 100).attr('aria-valuenow', 100);
            $('#progressModal').modal('hide');
            cb(null, data);
        },
        error: function (xhr, type, error) {
            $('#progressError').html(error);
            $('#progressAlert').css('display', 'block').alert();
            cb(error, type);
        },
        data: formData,
        cache: false,
        contentType: false,
        processData: false
    });

}


/*
 Fixup stacked modals
 */
$('.modal').on('hidden.bs.modal', function (event) {
    $(this).removeClass('fv-modal-stack');
    $('body').data('fv_open_modals', $('body').data('fv_open_modals') - 1);
});


$('.modal').on('shown.bs.modal', function (event) {
    /* keep track of the number of open modals */
    if (typeof( $('body').data('fv_open_modals') ) == 'undefined') {
        $('body').data('fv_open_modals', 0);
    }
    /* if the z-index of this modal has been set, ignore. */
    if ($(this).hasClass('fv-modal-stack')) {
        return;
    }
    $(this).addClass('fv-modal-stack');
    $('body').data('fv_open_modals', $('body').data('fv_open_modals') + 1);
    $(this).css('z-index', 1040 + (10 * $('body').data('fv_open_modals')));
    $('.modal-backdrop').not('.fv-modal-stack')
        .css('z-index', 1039 + (10 * $('body').data('fv_open_modals')));
    $('.modal-backdrop').not('fv-modal-stack')
        .addClass('fv-modal-stack');

});

(function ($) {
    if ($.fn.bootstrapValidator) {
        $.fn.bootstrapValidator.validators.selectized = {
            html5Attributes: {
                message: 'message',
                field: 'field',
                check_only_for: 'check_only_for'
            },
            validate: function (validator, $field, options) {
                var realInput = $field.parent().parent().parent().children('input.selectized');
                var rz = $.fn.bootstrapValidator.validators[options.validator].validate(validator, realInput, options);
                return rz;
            }
        }
    }

    $.fn.money_field = function (opts) {
        var defaults = { width: null, symbol: _currency?_currency.symbol:'$' };
        var opts = $.extend(defaults, opts);
        return this.each(function () {
            if (opts.width) {
                $(this).css('width', opts.width + 'px');
            }
            $(this).wrap("<div class='input-group'>").before("<span class='input-group-addon'>" + opts.symbol + "</span>");
        });
    };

    // Adapted from https://zenmoney.ru/demos/demo2.html
    // TODO no more floats.
    $.fn.zeninput = function(options){
        var options = jQuery.extend({
            error: false,
            comment: false,
            calculatewrapper: false,
            calculate: false,
            oncalculate: false,
            onendcalculate: false,
            onready: false,
            onfocus: false,
            onblur: false,
            onerror: false,
            onenter: false,
            onescape: false,
            oninput: false,
            ifnul: '',
            sign: false
        },options);
        var costToString = function(cost, fixed){
            var triadSeparator = ' ';
            var decSeparator = '.';
            var minus = '&minus;';
            var num = '0';
            var numd = '';
            var fractNum = 2;
            fixed = ( !fixed ) ? fixed = 2 : fixed;
            var fixedTest = '00';
            if( fixed != 2 ){
                fixedTest = '';
                for( var i = 0; i < fixed; i++ ){
                    fixedTest += String('0');
                }
            }
            if( !isNaN( parseFloat(cost) ) ){
                num = parseFloat(Math.abs(cost)).toFixed(fixed).toString();
                numd = num.substr(num.indexOf('.')+1, fixed).toString();
                num = parseInt(num).toString();
                var regEx = /(\d+)(\d{3})/;
                while (regEx.test(num)){
                    num = num.replace(regEx,"$1"+triadSeparator+"$2");
                }
                if( numd != fixedTest ){
                    var lastZeros = /[0]*$/g
                    num += decSeparator+numd.replace(lastZeros,'');
                }
                if( cost < 0 ) num = 'âˆ’'+num;
            }
            return num;
        }
        return this.each(function(){
            var nchars = new RegExp(/[\!\@\#\â„–\$\%\^\&\=\[\]\\\'\;\{\}\|\"\:\<\>\?~\`\_A-ZÐ-Ð¯a-zÐ°-Ñ]/);
            var achars = "1234567890+-/*,. ";
            var errTimer = undefined;
            var inObj = this;
            var elemW = 68;
            var oldVal = 0;
            var newVal = 0;
            var t = { left:0, top:0 };
            var absW = $(inObj).outerWidth(true);
            var absH = $(inObj).outerHeight(true);
            var absT = t.top - 4;
            var absL = isNaN( t.left + parseInt($(inObj).css('marginLeft'),10) - 4 )?0:(t.left + parseInt($(inObj).css('marginLeft'),10) - 4);
            var regClean = new RegExp(' ','gi');
            var aripm = new RegExp(/[\+\-\*\/]/);
            var aripmSt = new RegExp(/^[\+\-\*\/]/);
            var toOldVal = false;
            if(!options.calculatewrapper){
                options.calculatewrapper = jQuery('<div class="calculatewrapper"></div>');
                $(options.calculatewrapper).append('<div class="actWr">=</div>');
                $(options.calculatewrapper).css({
                    'position':'absolute',
                    'left':absL+'px',
                    'top':absT+'px',
                    'visibility':'hidden',
                    'zIndex':'0',
                    'background':'#cedeea',
                    'width':absW+'px',
                    'padding':absH+6+'px 3px 3px 3px'
                });
                $(inObj).after(options.calculatewrapper);
            }
            if(!options.calculate){
                options.calculate = jQuery('<span class="calcaction" style="font-weight:bold;"></span>');
                $('.actWr' ,options.calculatewrapper).css({'padding':'3px 0px 3px 0px'}).append(options.calculate);
            }
            $(this).focus(function(){
                oldVal = parseFloat( String(inObj.value).replace(/ /g, '').replace(/,/g,'.'), 10 );
                ( isNaN(oldVal) ) ? ( oldVal = 0 ) : oldVal;
                newVal = oldVal;
                //jQuery(inObj).css({'position':'relative', 'zIndex':2});
                t = $(inObj).position();
                absT = t.top - 4;
                var mL = $(inObj).css('marginLeft');
                mL = isNaN( parseInt(mL,10) )?( 0 ):( parseInt(mL,10) );
                absL = t.left + mL - 6;
                absW = $(inObj).outerWidth(true) + 13;
                absH = $(inObj).outerHeight(true);
                $(options.calculatewrapper).css({'z-index':1, 'left':absL+'px', 'top':absT-3+'px', 'width': absW+'px', 'padding':absH+6+'px 6px 2px 6px'});
                if (options.comment) $(options.comment).css({'display': 'block'});
                if(options.onfocus) options.onfocus(this);
            });
            $(this).blur(function(){
                if ( toOldVal ){
                    newVal = oldVal;
                }
                toOldVal = false;
                if( options.comment ) $(options.comment).css({'display':'none'});
                if( options.error ) $(options.error).css({'display':'none'});
                $(options.calculatewrapper).css({'visibility': 'hidden'});
                $(inObj).css({'position':'static'});
                if( options.sign ){
                    var sign = ( newVal < 0 )?( '-' ):( '' );
                }else{
                    var sign = '';
                }
                newVal = Math.abs(newVal);
                if( newVal != 0 ){
                    $(inObj).val( sign+costToString( newVal ) );
                    if(options.onblur) options.onblur(inObj, sign+costToString( newVal ));
                }else{
                    $(inObj).val( options.ifnul );
                    if(options.onblur) options.onblur(inObj, options.ifnul);
                }
            });
            $(this).keypress(function(e){
                var k, i;
                var tAllow = false;
                if (!e.charCode){
                    k = String.fromCharCode(e.which);
                    c = e.which;
                }else{
                    k = String.fromCharCode(e.charCode);
                    c = e.charCode;
                }
                if ( c == 37 || c == 39 ){ return true; }
                if( !e.ctrlKey ){
                    var res=nchars.test(k);
                    if ( res ){
                        if(options.comment) jQuery(options.comment).css({'display':'none'});
                        if(options.error) jQuery(options.error).css({'display':'block'});
                        if(options.onerror) options.onerror(inObj);
                        jQuery(inObj).addClass('error');
                        clearTimeout(errTimer);
                        errTimer = setTimeout(function(){
                            if( options.error ) jQuery(options.error).css({'display':'none'});
                            if( options.comment ) jQuery(options.comment).css({'display':'block'});
                            $(inObj).removeClass('error');
                        }, 3000);
                        return false;
                    }else{
                        if ( e.keyCode == 13 ){
                            if(options.onenter) setTimeout(function(){ options.onenter(inObj, newVal); }, 100);
                            inObj.blur();
                        }
                    }
                }
            });
            $(this).keyup(function(e){
                newVal = String(inObj.value).replace(/ /g, '').replace(/,/g, '.');
                if ( e.keyCode == 27 ){
                    toOldVal = true;
                    if(options.onescape) options.onescape(inObj, oldVal);
                    inObj.blur();
                    return;
                }

                var res = aripm.test(newVal);
                if(res){
                    res = aripmSt.test(newVal);
                    $(inObj).css({'position':'relative', 'zIndex':2});
                    $(options.calculatewrapper).css({'visibility': 'visible'});
                    if (res){
                        var tStr = String( oldVal ) + String(newVal);
                        try{
                            newVal = parseFloat( eval( tStr ), 10 );
                            newVal = isNaN( newVal )?( 0 ):( newVal );
                            newVal = isFinite( newVal )?( newVal ):( 0 );
                            $(options.calculate).html( costToString( newVal ) );
                        } catch(e) {
                            newVal = 0;
                            $(options.calculate).html( newVal );
                        }
                    }else{
                        var tStr = String(newVal);
                        try{
                            newVal = parseFloat( eval( tStr ), 10 );
                            newVal = isNaN( newVal )?( 0 ):( newVal );
                            newVal = isFinite( newVal )?( newVal ):( 0 );
                            $(options.calculate).html( costToString( newVal ) );
                        } catch(e) {
                            newVal = 0;
                            $(options.calculate).html( newVal );
                        }
                    }
                    if( options.oncalculate ) options.oncalculate(newVal);
                }else{
                    $(options.calculatewrapper).css({'visibility': 'hidden'});
                    $(inObj).css({'position':'static'});
                    if ( isNaN( parseFloat(newVal, 10) ) ){
                        newVal = 0;
                        $(options.calculate).html( newVal );
                    }else{
                        $(options.calculate).html( costToString( parseFloat(newVal, 10) ) );
                    }
                    if( options.onendcalculate ) options.onendcalculate(newVal);
                }
                if(options.oninput) options.oninput(this, e.keyCode);
            });

            if(options.onready) options.onready(this);
        });
    };
}(window.jQuery));

function wireValidatedSelectize(id, bv) {
    $('#' + id + '_div input.selectized').on('change.update.bv', function () {
        var bvo = bv.data('bootstrapValidator');
        bvo.enableFieldValidators(id, true);
        bvo.validateField(id);
    });
}

var AjaxDataSource = function (urlOrUrlFn) {
    this.url = urlOrUrlFn;
};

AjaxDataSource.prototype = {

    /**
     * Returns stored column metadata
     */
    columns: function () {
        return this._columns;
    },

    _buildResponse: function (options, callback) {
        var data = this.sourceData, self = this;
        // Return data to Datagrid
        if (options.search) {
            data = _.filter(data, function (item) {
                var match = false;

                if (self.searchProperties) {
                    self.searchProperties.forEach(function (prop) {
                        if ((item[prop]||'').toString().toLowerCase().indexOf(options.search.toLowerCase()) !== -1) match = true;
                    });
                } else {
                    _.each(item, function (prop) {
                        if (_.isString(prop) || _.isFinite(prop)) {
                            if (prop.toString().toLowerCase().indexOf(options.search.toLowerCase()) !== -1) match = true;
                        }
                    });
                }

                return match;
            });
        }
        if (typeof(self.filter) === 'function') {
            data = self.filter(data, options);
        }

        data = data || [];
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
        if (this.formatter) {
            var self = this;
            $.each(data, function (index, item) {
                self.formatter(index, item);
            });
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
        if (this.sourceData) {
            this._buildResponse(options, callback);
        } else {
            var self = this;
            url = this.url;
            if (typeof(url) === 'function') {
                url = url(this, options);
            }
            $.ajax({
                url: url,
                success: function (data) {
                    self.success(data, options, callback);
                },
                error: function (xhr, type, error) {
                    self.error(error, callback);
                }
            });
        }
    },

    error: function (e, cb) {
        cb();
    }
};

function fdsupport() {
    window.FreshWidget.show();
}

function m$(x) {
    return accounting.formatMoney(x);
}

(function(jQuery) {

    jQuery.eventEmitter = {
        _JQInit: function() {
            this._JQ = jQuery(this);
        },
        emit: function(evt, data) {
            !this._JQ && this._JQInit();
            this._JQ.trigger(evt, data);
        },
        once: function(evt, handler) {
            !this._JQ && this._JQInit();
            this._JQ.one(evt, handler);
        },
        on: function(evt, handler) {
            !this._JQ && this._JQInit();
            this._JQ.bind(evt, handler);
        },
        off: function(evt, handler) {
            !this._JQ && this._JQInit();
            this._JQ.unbind(evt, handler);
        }
    };

}(jQuery));

var _entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': '&quot;',
    "'": '&#39;',
    "/": '&#x2F;'
};

function $safe(string) {
    return String(string).replace(/[&<>"'\/]/g, function (s) {
        return _entityMap[s];
    });
}
