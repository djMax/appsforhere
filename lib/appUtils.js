/*───────────────────────────────────────────────────────────────────────────*\
 │  Copyright (C) 2014 eBay Software Foundation                               │
 |                                                                            |
 | yyyyyyyyyyyysssssssssss+++osssssssssssyyyyyyyyyyyy                         |
 | yyyyyysssssssssssssss/----../sssssssssssssssyyyyyy                         |
 | sysssssssssssssssss/--:-`    `/sssssssssssssssssys                         |
 | sssssssssssssssso/--:-`        `/sssssssssssssssss   AppsForHere           |
 | sssssssssssssso/--:-`            `/sssssssssssssss                         |
 | sssssssssssso/-::-`                `/sssssssssssss   Advanced integration  |
 | sssssssssso/-::-`                    `/sssssssssss   for PayPal Here and   |
 | sssssssso/-::-`                        `/sssssssss   the PayPal retail     |
 | ssssoso:-::-`                            `/osossss   family of products.   |
 | osooos:-::-                                -soooso                         |
 | ooooooo:---.``````````````````````````````.+oooooo                         |
 | oooooooooooooooooooooooooooooooooooooooooooooooooo                         |
 \*───────────────────────────────────────────────────────────────────────────*/
'use strict';

var domain = require('domain');
var logger = require('pine')();
var assert = require('assert');
var PayPalUser = null;
var PayPalDelegatedUser = null;
var Token = null;
var Liwp = require('./loginWithPayPal');

function ensureRequires() {
    if (!PayPalUser) {
        // This is here to avoid a cyclical require that causes mongoose to get confused
        Token = require('../models/auth/token');
        PayPalUser = require('../models/auth/payPalUser');
        PayPalDelegatedUser = require('../models/auth/payPalDelegatedUser');
    }
}

function setupForPayPalAccess(req, res, next) {
    // Since we store encrypted refresh tokens, if the LoginWithPayPal
    // infrastructure needs to refresh a token, we need access to the
    // request cookies to decrypt them.
    if (req.user) {
        req.user.attachRequest(req);
        // To allow better module/lib interop, we move these up to the request, so modules
        // can work even w/o a user (by the controller injecting these into the request)
        req.hereApiUrl = req.user.entity.hereApiUrl.bind(req.user.entity);
        req.hereApi = req.user.entity.hereApi.bind(req.user.entity);
    }
    if (next) {
        next();
    }
}

function loginWithQueryParams(req, res, next) {
    if (!req.user && req.query.delegate !== null) {
        ensureRequires();
        logger.debug('Logging in delegate from query arguments');
        PayPalDelegatedUser.login(req, res, {
            id: req.query.delegate,
            uuid: req.query.delegateuuid,
            password: req.query.delegatepassword
        }, function (e) {
            next(e);
        });
        return;
    }
    return next();
}

function ensureAuth(isInteractive, req, res, next) {
    req._isInteractiveAuth = isInteractive;
    setupForPayPalAccess(req);
    if (req.isAuthenticated()) {
        return next();
    }
    req.session.redirectUrl = req.url;
    if (isInteractive) {
        res.render('index', {showAlert: true});
    } else {
        res.redirect('/oauth/login');
    }
}

function ensureInteractive(req, res, next) {
    ensureAuth(true, req, res, next);
}

function ensureAutomatic(req, res, next) {
    ensureAuth(false, req, res, next);
}

function rolesMatch(roles, allowed) {
    for (var r = 0, len = roles.length; r < len; r++) {
        for (var a = 0, allowedLen = allowed.length; a < allowedLen; a++) {
            if (roles[r] === allowed[a]) {
                return true;
            }
        }
    }
    return false;
}

var hereapis = {};

var closure = module.exports = {
    configure: function (config) {
        var liwpConfig = config.get('loginWithPayPal');
        for (var env in liwpConfig) {
            logger.info('Created PayPal environment %s', env);
            var cfg = liwpConfig[env];
            var api = hereapis[env] = new Liwp({
                appId: cfg.client_id,
                secret: cfg.secret,
                strictSSL: cfg.insecure === true ? false : true,
                secureProtocol: cfg.secureProtocol,
                host: cfg.webappsHost
            });
            api.hereapiUrl = cfg.hereapiUrl;
            api.ppaasUrl = cfg.ppaasUrl;
            api.scopes = cfg.scopes;
        }
    },
    hereApis: hereapis,
    domain: function (req, res, next) {
        var d = domain.create();
        d.on('error', function (err) {
            try {
                // handle the error safely
                logger.error('Uncaught exception! %s\n%s', err.message, err.stack);
                next(err);
            } catch (x) {
                console.log(x);
            }
        });
        d.add(req);
        d.add(res);
        req.$eat = function (fn) {
            return req.activeDomain.intercept(fn);
        };
        req.activeDomain = d;
        d.run(next);

    },
    /**
     * Setup the request for PayPal Access - for example if a refresh token is used
     * to generate a new access token, it will save the new token to mongoDb when the
     * request completes.
     */
    payPalAccess: setupForPayPalAccess,
    /**
     * Make sure the request has an authenticated user and redirect to auth if not.
     */
    auth: ensureInteractive,
    /**
     * Make sure the request has an authenticated user and return an auth error if not.
     */
    apiAuth: ensureAutomatic,
    /**
     * Look for delegate info on the query params
     */
    loginWithQueryParams: loginWithQueryParams,
    /**
     * If role verification is desired, we need to generate a closure that will first
     * call the auth function and then call us to verify roles.
     * @param roles (as individual args)
     * @returns function(req,res,next) - to be used as middleware
     */
    hasRoles: function () {
        var roles = arguments;
        return function (req, res, next) {
            if (req.user.delegate && req.user.delegate.allowedResources) {
                var allowed = req.user.delegate.allowedResources;
                if (!rolesMatch(roles, allowed)) {
                    if (req._isInteractiveAuth) {
                        res.render('errors/401');
                    } else {
                        res.json({
                            success: false,
                            message: 'Access denied'
                        }, 401);
                    }
                    return;
                }
            }
            next();
        };
    },
    ROLES: {
        ViewProducts: 'ViewProducts',
        EditProducts: 'EditProducts',
        ViewLocations: 'ViewLocations',
        EditLocations: 'EditLocations',
        ViewReports: 'ViewReports',
        EditApps: 'EditApps',
        SaveVault: 'SaveVault',
        ManageHardware: 'ManageHardware'
    },
    hereApiUrl: function (env, method, api) {
        var base;
        if (api === 'ppaas') {
            base = closure.hereApi(env).ppaasUrl;
        } else {
            base = closure.hereApi(env).hereapiUrl;
        }
        return base + method;
    },
    hereApi: function (env) {
        if (!env || env === 'live' || env === 'paypal') {
            return hereapis.live;
        } else if (hereapis[env]) {
            return hereapis[env];
        } else {
            env = env.replace(/[^A-Za-z0-9]/g,'');
            logger.error('Unknown environment requested: %s', env);
            throw new Error('Unknown environment requested: ' + env);
        }
    },
    render: function (view) {
        return function (req, res) {
            res.render(view);
        };
    }
};
