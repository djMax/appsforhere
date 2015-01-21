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

module.exports = function (router) {

    router
        .use(appUtils.domain);

    router.route('/')
        .all(appUtils.auth)
        .get(function (req, res) {
            res.render('hosted/index', {
                appId: ObjectId().toHexString(),
                uuid:  uuid.v4()
            });
        })
        .post(function (req, res) {

            var secureConfig = {
                client_id: req.body.client_id,
                secret: req.body.secret
            };

            var app = new HostedApplication({
                _id: ObjectId(req.body.appId),
                owner_id: req.user.entity._id,
                environment: req.body.environment,
                return_urls: req.body.return_url.split(' ')
            });

            app.encryptSecureConfiguration(secureConfig, req.body.uuid, req.$eat(function () {
                app.save(req.$eat(function () {
                    res.render('hosted/complete',{
                        uuid: req.body.uuid,
                        appId: req.body.appId
                    });
                }));
            }));

            console.log(req.body);
        });

    router.route('/:docId')
        .get(function (req, res, next) {
        HostedApplication.findById(req.params.docId, req.$eat(function (doc) {
            doc.decryptSecureConfiguration(req.query.uuid, req.$eat(function (secureConfig) {
                var strategyArgs = {
                    clientID: secureConfig.client_id,
                    clientSecret: secureConfig.secret,
                    passReqToCallback: true,
                    name: req.params.docId,
                    scope: req.query.scope || 'openid',
                    callbackURL: 'http://localhost:8000/hosted/' + req.params.docId + '/return'
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

                var passport = new PayPalStrategy(strategyArgs, function (expressRequest, accessToken, refreshToken, profile, done) {
                    console.log('YESSIR');
                });

                passport.redirect = function (url) { res.redirect(url); };
                passport.authenticate(req, res, next);
            }));
        }));
    })

};