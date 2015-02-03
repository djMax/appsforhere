'use strict';

var logger = require('pine')();
var appUtils = require('../lib/appUtils');
var reportLib = require('../lib/reports/payPalSalesReportsApi');
var querystring = require('querystring');
var csv = require('csv');
var async = require('async');
var PayPalDelegatedUser = require('../models/auth/payPalDelegatedUser');
var PayPalUser = require('../models/auth/payPalUser');
var _ = require('underscore');

module.exports = function (router) {
    router.use(appUtils.domain);

    var hasViewReportRole = appUtils.hasRoles(appUtils.ROLES.ViewReports);

    router.get('/', appUtils.auth, hasViewReportRole, function (req, res) {
       res.render('reports/reports');
    });

    router.get('/api', appUtils.auth, hasViewReportRole, function (req, res) {
        var qs = _.clone(req.query);
        delete qs.url;
        reportLib.request(req, 'https://pph-reporting.pphme.ebaystratus.com/' + req.query.url + '?' + querystring.stringify(qs),
            function (rErr, rz) {
                if (rErr) {
                    logger.error('Error getting report: %s\n%s', rErr.message, rErr.stack);
                    res.json({errorCode: 0xdeadbeef, message: rErr.message});
                    return;
                }
                if (req.query.transform && reportLib.transformers[req.query.transform]) {
                    rz = reportLib.transformers[req.query.transform](rz);
                }
                res.json(rz);
            });
    });

    router.get('/export/:start/:end', appUtils.auth, hasViewReportRole, function (req, res) {
        var start = apiFormat(req.params.start), end = apiFormat(req.params.end);
        var hasMore = true, csvRows = [[
            'Invoice Id',
            'Order Number',
            'Invoice Date',
            'Currency',
            'Total',
            'Status',

        ]], raw = [], seen = {};

        var doPage = function () {
            req.user.hereApi().get({
                tokens: req.user.tokens(),
                url: req.user.hereApiUrl('invoices?maxResults=3000&endDate=' +
                encodeURIComponent(end) + '&startDate=' + encodeURIComponent(start)),
                json: true,
                headers: {
                    'Content-type': 'application/json'
                }
            }, req.$eat(function (json) {
                if (req.query.format === 'csv') {
                    toArray(json, csvRows, seen);
                } else {
                    raw = raw.concat(json.invoices);
                }
                if (json.hasMoreResults) {
                    console.log('HAS MORE');
                    end = json.invoices[json.invoices.length-1].invoiceDate;
                    doPage();
                } else {
                    if (req.query.format === 'csv') {
                        for (var i = 0; i < csvRows.length; i++) {
                            // This isn't the best way to generate this.
                            csvRows[i] = csvRows[i].join(',');
                        }
                        res.type('text/csv').send(csvRows.join('\n'));
                    } else {
                        res.send('<html><body><pre>' + JSON.stringify(raw, null, '\t') + '</pre></body></html>');
                    }
                }
            }));
        };

        doPage();
    });

    function toArray(json, rz, seen) {
        json.invoices.forEach(function (inv) {
            if (!seen[inv.invoiceID]) {
                rz.push([
                    inv.invoiceID,
                    inv.number,
                    inv.invoiceDate,
                    inv.currencyCode,
                    inv.total,
                    inv.status
                ]);
                seen[inv.invoiceID] = true;
            }
        });
    }

    function apiFormat(str) {
        return str + 'T00:00:00.000+0000';
    }
};
