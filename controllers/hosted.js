/**
 * The /hosted routes allow you to create applications using OTHER LoginWithPayPal applications but AppsForHere
 * infrastructure. For example, you could build a mobile point of sale using the PayPal Here mobile SDKs without
 * your own custom back end. (Or given that you're reading this source, you can modify this one as a starting point).
 */
'use strict';

var logger = require('pine')();
var appUtils = require('../lib/appUtils');
var ObjectId = require('mongoose').Types.ObjectId;
var uuid = require('uuid');
var PayPalStrategy = require('../lib/payPalStrategy');
var HostedApplication = require('../models/auth/hostedApplication');
var Liwp = require('../lib/loginWithPayPal');

module.exports = function (router) {

    router
        .use(appUtils.domain);

    router.route('/')
        .all(appUtils.auth)
        .get(function (req, res) {
            res.render('hosted/index', {
                appId: ObjectId().toHexString(),
                uuid: uuid.v4()
            });
        })
        .post(function (req, res) {

            var secureConfig = {
                client_id: req.body.client_id,
                secret: req.body.secret,
                token_key: uuid.v4()
            };

            var app = new HostedApplication({
                _id: ObjectId(req.body.appId),
                owner_id: req.user.entity._id,
                environment: req.body.environment,
                return_urls: req.body.return_url.split(' ')
            });

            app.encryptSecureConfiguration(secureConfig, req.body.uuid, req.$eat(function () {
                app.save(req.$eat(function () {
                    res.render('hosted/complete', {
                        uuid: req.body.uuid,
                        appId: req.body.appId
                    });
                }));
            }));
        });

    function getPassport(req, secureConfig, doc) {
        var strategyArgs = {
            clientID: secureConfig.client_id,
            clientSecret: secureConfig.secret,
            passReqToCallback: true,
            name: req.params.docId,
            scope: req.query.scope || 'openid',
            callbackURL: req.app.kraken.get('siteBaseUrl') + '/hosted/' +
                req.params.docId + '/return?uuid=' + req.query.uuid
        };
        if (doc.environment === 'sandbox') {
            var cfg = req.app.kraken.get('loginWithPayPal:sandbox');
            if (cfg.authorizationUrl) {
                strategyArgs.authorizationURL = cfg.authorizationUrl;
            }
            if (cfg.identityUrl) {
                strategyArgs.tokenURL = cfg.identityUrl + 'tokenservice';
                strategyArgs.profileURL = cfg.identityUrl + 'userinfo?schema=openid';
            }
        }

        return new PayPalStrategy(strategyArgs, function (expressRequest, accessToken, refreshToken, profile, done) {
            done(null, {
                access_token: accessToken,
                refresh_token: refreshToken
            });
        });
    }

    function buildUrl(doc, req, profile, encToken) {
        var url = doc.return_urls[0] || req.query.returnUrl;
        if (url.indexOf('?') >= 0) {
            url += '&';
        } else {
            url += '?';
        }

        var refresh = req.app.kraken.get('siteBaseUrl') + '/hosted/' +
            req.params.docId + '/refresh?uuid=' + req.query.uuid + '&token=' +
            encodeURIComponent(encToken);

        return url + 'refresh_url=' + encodeURIComponent(refresh) +
        '&access_token=' + encodeURIComponent(profile.access_token);
    }

    router.route('/:docId')
        .get(function (req, res, next) {
            HostedApplication.findById(req.params.docId, req.$eat(function (doc) {
                doc.decryptSecureConfiguration(req.query.uuid, req.$eat(function (secureConfig) {
                    var passport = getPassport(req, secureConfig, doc);
                    passport.redirect = function (url) {
                        res.redirect(url);
                    };
                    passport.authenticate(req, {session: false});
                }));
            }));
        });

    router.route('/:docId/return')
        .get(function (req, res, next) {
            HostedApplication.findById(req.params.docId, req.$eat(function (doc) {
                doc.decryptSecureConfiguration(req.query.uuid, req.$eat(function (secureConfig) {
                    var passport = getPassport(req, secureConfig, doc);
                    passport.userProfile = function (at, done) {
                        done(null, {});
                    };
                    passport.redirect = function (url) {
                        res.redirect(url);
                    };
                    passport.fail = function (error) {
                        logger.error('Passport auth failed: %s\n%s', error.message, error.stack);
                        res.render('hosted/failed', {error: error});
                    };
                    passport.success = function (profile) {
                        doc.generateRefreshToken(profile.refresh_token, secureConfig.token_key, function (cryptErr, encToken) {
                            logger.debug('Passport auth succeeded.');
                            res.redirect(buildUrl(doc, req, profile, encToken));
                        });
                    };
                    passport.error = function (error) {
                        logger.error('Passport auth failed: %s\n%s', error.message, error.stack);
                        res.render('hosted/failed', {error: error});
                    };
                    passport.authenticate(req, {session: false});
                }));
            }));
        });

    function refresh(req, doc, secureConfig, token, callback) {
        doc.decryptRefreshToken(token, secureConfig.token_key, req.$eat(function (refresh_token) {
            var config = {
                appId: secureConfig.client_id,
                secret: secureConfig.secret
            };
            if (doc.environment === 'sandbox') {
                var cfg = req.app.kraken.get('loginWithPayPal:sandbox');
                config.host = cfg.webappsHost;
            }
            var liwp = new Liwp(config), tokenInfo = {refresh_token:refresh_token};
            liwp.refresh(tokenInfo, req.$eat(function () {
                callback(null, tokenInfo.access_token);
            }));
        }));
    }

    router.route('/:docId/refresh')
        .get(function (req, res, next) {
            HostedApplication.findById(req.params.docId, req.$eat(function (doc) {
                doc.decryptSecureConfiguration(req.query.uuid, req.$eat(function (secureConfig) {
                    refresh(req, doc, secureConfig, req.query.token, req.$eat(function (at) {
                        res.json({access_token:at});
                    }));
                }));
            }));
        });

};
