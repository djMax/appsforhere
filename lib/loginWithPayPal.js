'use strict';

var wreck = require('wreck');
var objutil = require('objutil');
var uuid = require('uuid');
var assert = require('assert');
var log = require('pine')();
var querystring = require('querystring');
var URL = require('url');

var didWarnSSL = false;
/**
 * Create an Liwp instance in the context of an appId, secret, returnUrl
 * and host (at a minimum).
 * @param config
 * @constructor
 */
function Liwp(config) {
    this.config = objutil.copy(config);
    if (!this.config.baseUrl && this.config.host) {
        if (this.config.host.indexOf('stage2') === 0 && this.config.host.indexOf('.') < 0) {
            this.config.host = 'www.' + this.config.host + '.qa.paypal.com';
        }
        this.config.baseUrl = 'https://' + this.config.host + '/webapps/auth/';
    }
    if (!this.config.baseUrl) {
        // Go live yo.
        this.config.baseUrl = 'https://www.paypal.com/webapps/auth/';
    }
}

module.exports = Liwp;

/**
 * Get token details from an access token (validity, scopes granted, etc)
 * @param token The access token
 * @param callback called with (error, details)
 */
Liwp.prototype.getTokenDetails = function (token, callback) {
    var body = querystring.stringify({
        'validate-Access-Token': 'Validate Access Token',
        access_token: token
    });
    wreck.post(this.config.baseUrl + 'protocol/openidconnect/v1/validatetoken', {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            'Content-Length': body.length
        },
        payload: body
    }, function (e, r) {
        if (e) {
            callback(e);
            return;
        }
        var ex = null;
        try {
            var b = JSON.parse(r.body.toString());
            try {
                callback(null, b);
            } catch (cbEx) {
                ex = cbEx;
            }
        } catch (x) {
            callback(x, null);
        }
        if (ex) {
            throw ex;
        }
    });
};

/**
 * Refresh an access_token in tokenInfo using the refresh_token in tokenInfo
 * @param tokenInfo access_token and refresh_token
 * @param callback (error) - tokenInfo is modified in place
 */
Liwp.prototype.refresh = function (tokenInfo, callback) {
    var config = this.config, _this = this;
    if (!tokenInfo.access_token) {
        tokenInfo.access_token = '<empty>';
    }
    log.debug('Refreshing access token %s for app %s', tokenInfo.access_token, config.appId);
    var auth = 'Basic ' + new Buffer(config.appId + ':' + config.secret).toString('base64');
    var refresh = tokenInfo.refresh_token;
    var poster = function (error, refresh_token) {
        if (error) {
            callback(error);
            return;
        }
        var body = querystring.stringify({
            grant_type: 'refresh_token',
            refresh_token: refresh_token
        });
        var rqOptions = {
            headers: {
                'authorization': auth,
                'content-type': 'application/x-www-form-urlencoded; charset=utf-8'
            },
            json: true,
            payload: body
        };

        wreck.post(config.baseUrl + 'protocol/openidconnect/v1/tokenservice', rqOptions, function (e, r, payload) {
            if (e) {
                log.debug('Failed to refresh access token: %s\n%s', e, e.stack);
                callback(e);
            } else if (r.statusCode < 200 || r.statusCode >= 300) {
                log.debug('Failed to refresh access token: %s\n%s', r.statusCode, r.headers);
                callback(new Error('HTTP Failure refreshing token '+ r.statusCode));
            } else {
                try {
                    if (payload.error) {
                        log.debug('Failed to refresh access token: %s\n%s', payload.error, payload.error_description);
                        callback(new Error(payload.error));
                        return;
                    }
                    tokenInfo.access_token = payload.access_token;
                    log.debug('Successfully refreshed access token.');
                } catch (ex) {
                    log.debug('Invalid body received from token refresh: %s\n%s', ex, payload);
                    callback(ex);
                    return;
                }
                callback(null);
            }
        });
    };

    // Sometimes people may want to provide additional safety around the refresh token
    // In that case they can pass us a function and we'll call it before refreshing.
    // The function needs to call the poster function with either an error or the refresh token
    if (typeof(refresh) === 'function') {
        refresh = refresh(tokenInfo, poster);
    } else {
        poster(null, refresh);
    }

};

/**
 * Make an HTTP/HTTPS request given the access_token in options.tokens, and refresh if necessary.
 * @param options Normal httpunch options, and tokens for the access_token and refresh_token info. You can also
 *      set json: true to have us parse the results as JSON. You can also set the tokens property on the Liwp
 *      object itself, if you intend to make all calls with the same token.
 * @param callback (error, responseBodyOrJson, rawResponse)
 */
Liwp.prototype.request = function (options, callback) {
    options = objutil.copy(options);
    var tokenInfo = options.tokens || this.tokens, config = this.config, _this = this;
    assert(tokenInfo, 'Missing tokens option, cannot use Liwp without an access_token and/or refresh_token in this option.');
    assert(tokenInfo.access_token || tokenInfo.refresh_token, 'Missing access_token and refresh_token on token object in options. Need at least one.');

    if (!tokenInfo.access_token) {
        log.debug('No access_token for request, refreshing immediately.');
        this.refresh(tokenInfo, function (refreshError) {
            if (refreshError) {
                callback(refreshError);
            } else {
                _this.request(options, callback);
            }
        });
        return;
    }
    options.headers = options.headers || {};
    options.headers.Authorization = 'Bearer ' + tokenInfo.access_token;

    wreck.request(options.method, options.url, options, function (error, response) {
        if (error) {
            callback(error);
            return;
        }
        var needsRefresh = response &&
            (response.statusCode === 401 || response.statusCode === 403) &&
            !options._alreadyRefreshed;
        if (needsRefresh) {
            log.debug('Received 401 - attempting a token refresh.');
            options._alreadyRefreshed = true;
            _this.refresh(tokenInfo, function (refreshError) {
                if (refreshError) {
                    callback(refreshError);
                } else {
                    _this.request(options, callback);
                }
            });
        } else {
            wreck.read(response, {json: options.json}, function (readError, payload) {
                callback(readError, payload, response);
            });
        }
    });
};

var methods = {
    GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE',
    HEAD: 'HEAD', OPTIONS: 'OPTIONS', TRACE: 'TRACE',
    CONNECT: 'CONNECT', PATCH: 'PATCH'
};

/*
 * Build helper methods for http operations. Example: httpunch.get, httpunch.post...
 */
Object.keys(methods).forEach(function (method) {
    var fn = function (options, callback) {
        options = objutil.copy(options);
        options.method = method;
        return this.request(options, callback);
    };

    method = method.toLowerCase();

    Liwp.prototype[method] = fn;
});