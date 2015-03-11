'use strict';
var logger = require('pine')(),
    appUtils = require('../../lib/appUtils'),
    accounting = require('accounting'),
    checkinUtils = require('../../lib/apps/utils'),
    App = require('../../models/app'),
    uuid = require('node-uuid'),
    marky = require('marky-markdown');

module.exports = function (router) {

    router.use(appUtils.domain);

    router.param('id', function (req, res, next, id) {
        if ((/^[0-9A-F]+$/i).test(id)) {
            next();
        } else {
            // This is really, really gross. But it makes
            // the route engine proceed to the next route.
            next('route');
        }
    });

    var hasEditRole = appUtils.hasRoles(appUtils.ROLES.EditApps);

    /*
     * Consumer implementation
     */

    /**
     * Render the consumer amount entry app
     */
    router.get('/:id', checkinUtils.addAppToRequest, function (req, res) {
        var model = {
            app: req.checkinApp.app,
            key: req.params.uuid,
            id: req.params.id,
            welcome: req.checkinApp.app.configuration.welcomeMessage ? marky(req.checkinApp.app.configuration.welcomeMessage).html() : null,
            thanks: req.checkinApp.app.configuration.thankyouMessage ? marky(req.checkinApp.app.configuration.thankyouMessage).html() : null
        };
        if (req.query.test) {
            model.test = true;
            if (req.query.testFail) {
                model.testFail = true;
            }
        }
        res.render('apps/amount/amount', model);
    });

    /**
     * Complete a payment by calling the MIS APIs and send any notifications required to the merchant.
     */
    router.post('/complete/:id', checkinUtils.addAppTabAndLocationToRequest, function (req, res) {
        var url = req.hereApiUrl('pay');
        req.hereApi().post({
            url: url,
            json: true,
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify({
                invoice: {
                    merchantEmail: req.checkinApp.secureConfig.email,
                    currencyCode: req.checkinApp.app.configuration.currency || 'USD',
                    merchantInfo: {
                        businessName: req.checkinApp.location.name,
                        address: req.checkinApp.location.address
                    },
                    items: [
                        {
                            name: req.checkinApp.app.configuration.description || 'Purchase',
                            quantity: 1,
                            unitPrice: req.body.amount
                        }
                    ],
                    paymentTerms: 'DueOnReceipt',
                    receiptDetails: {
                        appsforhere: {
                            appId: req.checkinApp.app._id
                        }
                    }
                },
                paymentType: 'tab',
                tabId: req.query.tabId
            }),
            tokens: req.checkinApp.tokens
        }, req.$eat(function (payResult) {
            if (!payResult.transactionNumber) {
                logger.error('Tab payment failed:\n%j', payResult);
                res.json({success: false, message: 'We were unable to complete payment.'});
                return;
            }
            var notificationInfo = checkinUtils.getNotificationInfo(req.checkinApp.secureConfig);
            if (notificationInfo) {
                var props = {
                    type: notificationInfo.email ? 'email' : 'sms',
                    template: 'apps/amountCompleteMerchant',
                    context: {
                        amountFormatted: accounting.formatMoney(req.body.amount),
                        customerId: req.checkinApp.tab.customerId,
                        customerName: req.checkinApp.tab.customerName,
                        photoUrl: req.checkinApp.tab.photoUrl,
                        amount: req.body.amount,
                        email: notificationInfo.email,
                        sms: notificationInfo.sms,
                        invoiceId: payResult ? payResult.invoiceId : null
                    }
                };
                checkinUtils.addNotification(res, props);
            } else {
                res.json({success: true});
            }
        }));
    });

    /*
     * Merchant-side application configuration.
     * Unfortunately, because of some "shortcomings" with express, the order is important
     * here or /new will be misinterpreted as /:id on the consumer side. Doesn't seem
     * like you can specify regex's that prevent mismatches anymore
     */

    /**
     * Simple render for the "new amount app" page
     */
    router.get('/new', appUtils.auth, hasEditRole, appUtils.render('apps/amount/configure'));

    /**
     * Create a new amount app via POST
     */
    router.post('/', appUtils.apiAuth, hasEditRole, function (req, res) {
        // Need to get the refresh token to save to the new app. Since it's encrypted,
        // we need the 'middleware' to decrypt it using the uuid key in the session
        req.user.tokens().refresh_token(null, req.$eat(function (rt) {
            var newApp = new App({
                name: req.body.appName,
                profileId: req.user.entity.profileId,
                applicationType: 'amount',
                configuration: {
                    access_token: req.session.access_token,
                    amounts: req.body.amounts ? req.body.amounts.split(',') : null,
                    customAmount: req.body.customAmount,
                    completionType: req.body.completionType,
                    welcomeMessage: req.body.welcomeMessage,
                    thankyouMessage: req.body.thankyouMessage,
                    description: req.body.description
                }
            });
            var key = uuid.v4();
            newApp.encryptSecureConfiguration({
                refresh_token: rt,
                email: req.user.entity.email,
                notification: req.body.notification
            }, key, req.$eat(function () {
                newApp.save(req.$eat(function () {
                    res.redirect('/apps/amount/edit/' + newApp.id + '?uuid=' + key);
                }));
            }));
        }));
    });

    /**
     * Display the app information for editing
     */
    router.get('/edit/:id', appUtils.auth, hasEditRole, checkinUtils.addAppToRequestForAuthenticatedUser,
        function (req, res) {
            res.render('apps/amount/configure', {
                app: req.checkinApp.app,
                amountFieldValue: req.checkinApp.app.configuration.amounts ? req.checkinApp.app.configuration.amounts.join(',') : '',
                key: req.query.uuid,
                host: req.headers.host
            });
        });

    /**
     * Modify an existing amount app
     */
    router.post('/:id(^[^n].*$)', appUtils.apiAuth, hasEditRole, checkinUtils.addAppToRequestForAuthenticatedUser,
        function (req, res) {
            // Update the non-secure parts of the app
            var doc = req.checkinApp.app;
            doc.configuration.amounts = req.body.amounts ? req.body.amounts.split(',') : null;
            doc.configuration.customAmount = req.body.customAmount;
            doc.configuration.completionType = req.body.completionType;
            doc.configuration.welcomeMessage = req.body.welcomeMessage;
            doc.configuration.thankyouMessage = req.body.thankyouMessage;
            doc.configuration.currency = req.user.entity.currency;
            doc.configuration.description = req.body.description;
            doc.markModified('configuration');
            doc.save(req.$eat(function () {
                res.render('apps/amount/configure', {
                    app: doc,
                    key: req.query.uuid,
                    amountFieldValue: doc.configuration.amounts ? doc.configuration.amounts.join(',') : '',
                    host: req.headers.host
                });
            }));
        });
};
