/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2014 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';

var logger = require('pine')();
var wreck = require('wreck');
var Liwp = require('../loginWithPayPal');
var Cookie = require('cookie-jar');
var _ = require('underscore');

var inflight = {};

function readCookies(expressRequest, cookieResponse) {
    var cookieJar = new Cookie.Jar();
    if (expressRequest.session.reportingCookies) {
        expressRequest.session.reportingCookies.forEach(function (c) {
            cookieJar.add(new Cookie(c));
        });
    }
    if (cookieResponse.headers && cookieResponse.headers['set-cookie']) {
        cookieResponse.headers['set-cookie'].forEach(function (c) {
            cookieJar.add(new Cookie(c));
        });
    }
    // Store the cookies for later
    saveToSession(expressRequest, cookieJar);
}

function saveToSession(expressRequest, jar) {
    var sArr = [];
    jar.cookies.forEach(function (c) {
        sArr.push(c.toString());
    });
    expressRequest.session.reportingCookies = sArr;
}

function addCookiesToRequest(expressRequest, request) {
    if (expressRequest.session.reportingCookies) {
        // Apply the cookies to the wreck request
        var jar = new Cookie.Jar();
        expressRequest.session.reportingCookies.forEach(function (cstr) {
            if (typeof(cstr) === 'string') {
                jar.add(new Cookie(cstr));
            }
        });
        var ck = jar.get(request);
        if (ck && ck.length) {
            var vals = [];
            ck.forEach(function (cookie) {
                vals.push(cookie.name + '=' + cookie.value);
            });
            request.headers = request.headers || {};
            request.headers.cookie = vals.join(';') + ';';
        }
    }
}

function doReportingRequest(expressRequest, urlOrReportingRequestOptions, callback) {
    if (typeof(urlOrReportingRequestOptions) === 'string') {
        urlOrReportingRequestOptions = {
            url: urlOrReportingRequestOptions
        };
    }
    var rq = _.clone(urlOrReportingRequestOptions);
    var url = rq.url;
    if (!rq.hasOwnProperty('json')) {
        rq.json = true;
    }
    addCookiesToRequest(expressRequest, rq);
    rq.secureProtocol = 'TLSv1_method';

    wreck.get(rq.url, rq, function (err, result, body) {
        if (err) {
            logger.error('Reporting request failed: %s', err.message);
            callback(err);
        } else if (result.statusCode === 401) {
            if (urlOrReportingRequestOptions._alreadyReauthed) {
                logger.debug('Reporting auth failed.');
                callback(new Error('Reporting authentication failed: ' + result.statusCode));
            } else {
                var doneFn = function (authErr) {
                    if (authErr) {
                        callback(authErr);
                    } else {
                        // wreck or somebody mucks with the URL and removes it, but cookie jar needs it.
                        rq.url = url;
                        doReportingRequest(expressRequest, urlOrReportingRequestOptions, callback);
                    }
                };

                if (inflight[expressRequest.user.entity.profileId]) {
                    inflight[expressRequest.user.entity.profileId].listeners.push({
                        rq:expressRequest,
                        fn:doneFn
                    });
                    logger.debug('Queueing completion handler for reporting auth (%d).', inflight[expressRequest.user.entity.profileId].listeners.length);
                    return;
                }
                logger.debug('Starting reporting auth');
                readCookies(expressRequest, result);
                urlOrReportingRequestOptions._alreadyReauthed = true;
                startReportingAuth(expressRequest, body, doneFn);
            }
        } else {
            readCookies(expressRequest, result);
            callback(err, body, result);
        }
    });
}

function doCallbacks(cookies, info, e) {
    info.listeners.forEach(function (cbInfo) {
        try {
            if (!e) {
                // Apply updated cookies to the target session
                cbInfo.rq.session.reportingCookies = cookies;
            }
            cbInfo.fn(e);
        } catch (x) {
            logger.error('Failed to invoke completion handler for reporting request: %s\n%s', x.message, x.stack);
        }
    });
    delete inflight[info.id];
}

/**
 * Use the current user access_token to get a reporting server cookie
 * @param req the express request
 * @param info the auth info from reporting
 * @param cb the callback which only takes an error object (reporting server cookies will be stored in the session)
 */
function startReportingAuth(req, info, cb) {
    var listenerInfo = inflight[req.user.entity.profileId] = {listeners: [{fn:cb,rq:req}], id: req.user.entity.profileId};
    // Make a cheap call to identity to make sure our token is fresh
    req.user.hereApi().get({
        tokens: req.user.tokens(),
        json: true,
        url: 'https://api.paypal.com/v1/identity/openidconnect/userinfo?schema=openid'
    }, function (uiErr, uiRz) {
        if (uiErr) {
            logger.error('Reporting auth identity error: %s', uiErr.message);
            doCallbacks(listenerInfo, uiErr);
        } else if (!uiRz || !uiRz.email) {
            logger.error('Reporting auth identity failed: %j', uiRz);
            doCallbacks(null, listenerInfo, new Error('Failed to get user details during reporting'));
        } else {
            completeAuth(req, info, function (e) {
                doCallbacks(req.session.reportingCookies, listenerInfo, e);
            });
        }
    });
}

/**
 * Call the reporting server given a fresh access token and the appropriate returnUrl from
 * the original reporting server call (which likely got a 401)
 */
function completeAuth(expressRequest, info, cb) {
    var url = info.returnUrl + '?access_token=' + encodeURIComponent(expressRequest.user.tokens().access_token);
    doReportingRequest(expressRequest, {url: url, json: false}, function (authErr, authBody, authRz) {
        if (authErr) {
            logger.error('Reporting auth completion error: %s', authErr.message);
            cb(authErr);
        } else if (authRz.statusCode !== 200) {
            if (expressRequest._alreadyFailedReportingAuth) {
                logger.error('Unknown result from reporting handshake: %s\n%s', authRz.statusCode, authBody ? authBody.toString() : 'empty body');
                cb(new Error('Unknown result from PayPal reporting handshake: ' + authRz.statusCode));
            } else {
                // Try again, sometimes we're too fast.
                logger.warn('PayPal reporting handshake failed, trying again.');
                expressRequest._alreadyFailedReportingAuth = true;
                completeAuth(expressRequest, info, cb);
            }
        } else {
            readCookies(expressRequest, authRz);
            cb();
        }
    });
}

module.exports = {
    request: doReportingRequest,
    today: function () {
        var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
        return [d.getFullYear(), m < 10 ? ('0' + m) : m, day < 10 ? ('0' + day) : day].join('-');
    },
    /**
     * The sales reporting API formats are incredibly verbose. The transformers can help.
     */
    transformers: {
        daily: function (rz) {

        }
    }
};
