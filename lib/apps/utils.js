/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2016 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';

var logger = require('pine')(),
    App = require('../../models/app'),
    PayPalUser = require('../../models/auth/payPalUser'),
    Queue = require('../queue');

var appFunctions = module.exports = {
    cleanupInvoice: function (inv) {
        (inv.items || []).forEach(function (it) {
            delete it.itemId;
            delete it.detailId;
        });
    },
    addNotification: function addNotification(res, props) {
        Queue.notificationQueue.add(props, function (err) {
            if (err) {
                logger.error('Failed to add notification:%s\n%j\n', err.message, props);
                // Don't fail the transaction just because the notification didn't queue
                res.json({success: true, warning: {code: 0xdeadbeef, message: 'Merchant notification failed.'}});
            } else {
                res.json({success: true});
            }
        });
    },
    /**
     * Add the information about the app to the express request object.
     * The express request will have a checkinApp object with app and secureConfig keys.
     * If the request did not include the UUID key (for config decryption), the
     * secureConfig key will not be present.
     * @param req Express request object
     * @param res Express response object
     * @param next callback(error) will be called with any error (or null)
     */
    addAppToRequest: function (req, res, next) {
        App.findById(req.params.id, req.$eat(function (app) {

            // We don't operate with a logged in user (usually) and don't setup our request
            // for PayPal Access usage. So we need to do this bit manually. This is begging
            // for a refactor.
            if (!req.user) {
                var fakeUser = new PayPalUser({environment: app.environment});
                req.hereApiUrl = fakeUser.hereApiUrl;
                req.hereApi = fakeUser.hereApi;
            } else if (!req.hereApiUrl) {
                req.hereApiUrl = req.user.hereApiUrl;
                req.hereApi = req.user.hereApi;
            }

            req.checkinApp = req.checkinApp || {};
            req.checkinApp.app = app;
            if (req.query.uuid) {
                req.checkinApp.app.decryptSecureConfiguration(req.params.uuid || req.query.uuid, req.$eat(function (config) {
                    req.checkinApp.secureConfig = config;
                    next();
                }));
            } else {
                next();
            }
        }));
    },
    addAppToRequestForAuthenticatedUser: function (req, res, next) {
        appFunctions.addAppToRequest(req, res, function (err) {
            if (!err && req.checkinApp.app) {
                if (req.checkinApp.app.profileId !== req.user.entity.profileId) {
                    res.render('errors/401');
                    return;
                }
                next();
            } else {
                next(err || new Error('Checkin app was not found.'));
            }
        });
    },
    addAppAndTokensToRequest: function (req, res, next) {
        appFunctions.addAppToRequest(req, res, function (err) {
            if (!err && req.checkinApp.secureConfig) {
                // Setup the request to make a call to the PayPal MIS APIs and save any updated access token
                // back to the app configuration
                req.checkinApp.tokens = {
                    access_token: req.checkinApp.app.configuration.access_token,
                    refresh_token: function (user, rtcb) {
                        // Save the new access token when we're done.
                        res.on('finish', function () {
                            if (req.checkinApp.tokens.access_token) {
                                logger.debug('Saving updated access_token for CheckIn App');
                                App.update({_id: req.checinApp.app._id}, {$set: {access_token: req.checkinApp.tokens.access_token}}, function (e) {
                                    if (e) {
                                        logger.warn('Failed to save update: %s\n%s', e.message, e.stack);
                                    }
                                });
                            }
                        });
                        rtcb(null, req.checkinApp.secureConfig.refresh_token);
                    }
                };
            } else {
                next(err || new Error('Secure configuration data is not available.'));
            }
        });
    },
    getNotificationInfo: function getNotificationInfo(secureConfig) {
        if (!secureConfig || !secureConfig.notificationAddress) {
            return null;
        }
        var addr = secureConfig.notificationAddress;
        if (addr.indexOf('@') < 0) {
            return {sms: addr};
        } else {
            return {email: addr};
        }
    },
    addAppAndTabToRequest: function (req, res, next) {
        appFunctions.addAppAndTokensToRequest(req, res, function (err) {
            if (!err && req.checkinApp.tokens) {
                // Fetch the tab info
                var url = req.hereApiUrl('locations/' + req.query.locationId + '/tabs/' + req.query.tabId);
                req.hereApi().get({
                    url: url,
                    json: true,
                    tokens: req.checkinApp.tokens
                }, req.$eat(function (tab) {
                    req.checkinApp.tab = tab;
                    next();
                }));
            } else {
                next(err || new Error('No PayPal Access tokens available to fetch tab information.'));
            }
        });
    },
    addAppTabAndLocationToRequest: function (req, res, next) {
        appFunctions.addAppAndTabToRequest(req, res, function (err) {
            if (!err && req.checkinApp.tab) {
                var url = req.hereApiUrl('locations/' + req.query.locationId);
                req.hereApi().get({
                    url: url,
                    json: true,
                    tokens: req.checkinApp.tokens
                }, req.$eat(function (loc) {
                    req.checkinApp.location = loc;
                    next();
                }));
            } else {
                next(err || new Error('No tab available on request, so will not waste time fetching location.'));
            }
        });
    }
};
