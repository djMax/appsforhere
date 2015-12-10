'use strict';
var appUtils = require('../lib/appUtils');
var wreck = require('wreck');
var FormData = require('form-data');
var Image = require('../models/image');
var imgHelper = require('../lib/products/img-canvas-helper');
var fs = require('fs');
var logger = require('pine')();

var builtInButtons = ['bid','donate','order','schedule','viewbill'];

module.exports = function (router) {

    router.use(appUtils.domain);
    var hasViewRole = appUtils.hasRoles(appUtils.ROLES.ViewLocations),
        hasEditRole = appUtils.hasRoles(appUtils.ROLES.EditLocations);

    /**
     * Index page - renders the main client page
     */
    router.get('/', appUtils.auth, hasViewRole, function (req, res) {
        res.render('locations/index');
    });

    /**
     * Get all locations
     */
    router.get('/api', appUtils.apiAuth, hasViewRole, function (req, res) {
        req.user.hereApi().get({
            tokens: req.user.tokens(),
            url: req.user.hereApiUrl('locations'),
            json: true,
            headers: {
                'Content-type': 'application/json'
            }
        }, req.$eat(function (json) {
            res.json(json);
        }));
    });

    /**
     * Get open tabs for a location
     */
    router.get('/api/:id/tabs', appUtils.apiAuth, hasViewRole, function (req, res) {
        req.user.hereApi().get({
            tokens: req.user.tokens(),
            url: req.user.hereApiUrl('locations/'+req.params.id+'/tabs'),
            json: true,
            headers: {
                'Content-type': 'application/json'
            }
        }, req.$eat(function (json) {
            res.json(json);
        }));
    });

    /**
     * Set the image for a location
     */
    router.post('/api/image', appUtils.apiAuth, hasEditRole, function (req, res) {
        fs.readFile(req.files.imageupload.path, req.$eat(function (data) {
            imgHelper.resize(data, 200, 200, req.$eat(function (thumb) {
                thumb.toBuffer('png', req.$eat(function (thumbBuffer) {
                    var hash = require('crypto').createHash('sha512').update(data).digest('hex');
                    Image.findOrCreate({ hash: hash },
                        {
                            width: thumb.width,
                            height: thumb.height,
                            png: thumbBuffer,
                            originalImage: data
                        },
                        { upsert: true },
                        req.$eat(function (imageDoc) {
                            res.json({
                                url: 'https://' + req.headers.host + '/image/' + imageDoc.id
                            });
                        }));
                }));
            }));
        }));
    });

    /**
     * Set the app for a location
     */
    router.post('/api/:id/app', appUtils.apiAuth, hasEditRole, function (req, res) {
        var button = req.body.button.toLowerCase(), updates = {}, found = false;
        for (var bi = 0; bi < builtInButtons.length; bi++) {
            if (builtInButtons[bi] === button) {
                updates.tabExtensionButtonType = builtInButtons[bi].toUpperCase();
                updates.tabExtensionButtonText = null;
                found = true;
                break;
            }
        }
        if (!found) {
            updates.tabExtensionButtonType = 'FREE_FORM_TEXT';
            updates.tabExtensionButtonText = req.body.button;
        }
        updates.tabExtensionUrl = req.body.url;
        updates.tabExtensionType = req.body.type;

        req.user.hereApi().post({
            tokens: req.user.tokens(),
            url: req.user.hereApiUrl('locations/'+req.params.id),
            json: true,
            headers: {
                'Content-type': 'application/json'
            },
            body: JSON.stringify(updates)
        }, req.$eat(function (json) {
            res.json(json);
        }));
    });

    /**
     * Delete a location
     */
    router.delete('/api/:id', appUtils.apiAuth, hasEditRole, function (req, res) {
        var url = req.user.hereApiUrl('locations/' + req.params.id);
        req.user.hereApi().delete({
            tokens: req.user.tokens(),
            url: url,
            json: true,
            headers: {
                'Content-type': 'application/json',
                'Content-length': 0
            }
        }, req.$eat(function (json, response) {
            res.json(json);
        }));
    });

    /**
     * The workhorse - save a location and potentially a location logo
     */
    router.post('/api', appUtils.apiAuth, hasEditRole, function (req, res) {
        logger.debug('Saving location: %j', (req.body && req.body.model) ? req.body.model : 'empty');
        var model = JSON.parse(req.body.model);
        // We need an picture URL, so we'll have to make one if it isn't already there.
        if (model.logoUrl && model.logoUrl.length && model.logoUrl.indexOf('https://pics.paypal.com/') !== 0) {
            // TODO factor this out into another fn
            logger.debug('Saving location image');
            var logo = model.logoUrl;
            delete model.logoUrl;
            saveLocation(req, model, function (loc) {
                if (!loc.success) {
                    res.json(loc);
                    return;
                }
                wreck.get(logo, {
                    rejectUnauthorized: false
                }, req.$eat(function (response) {
                    if (response.httpStatusCode < 200 || response.httpStatusCode > 299) {
                        loc.success = false;
                        loc.message = 'Failed to fetch logoUrl from ' + logo + ' (' + response.httpStatusCode + ')';
                        res.json(loc);
                        return;
                    }

                    var form = new FormData();
                    var bodyBuffers = [];
                    form.on('end', function () {
                        var body = Buffer.concat(bodyBuffers);
                        var headers = form.getHeaders({});
                        headers['MIME-Version'] = '1.0';
                        req.user.hereApi().post({
                            url: req.user.hereApiUrl('locations/' + loc.id + '/logo'),
                            body: body,
                            tokens: req.user.tokens(),
                            headers: headers
                        }, req.$eat(function (body, response) {
                            if (response.statusCode === 201) {
                                loc.logoUrl = response.location;
                            }
                            loc.success = true;
                            res.json(loc);
                        }));
                    });
                    form.on('data', function (chunk) {
                        if (typeof(chunk) === 'string') {
                            chunk = new Buffer(chunk, 'binary');
                        }
                        bodyBuffers.push(chunk);
                    });
                    form.on('error', function (err) {
                        loc.success = false;
                        loc.message = err.message;
                        res.json(loc);
                        return;
                    });
                    form.append('file', response.body, {
                        header: '--' + form.getBoundary() + FormData.LINE_BREAK +
                            'Content-Disposition: form-data; name=file' +
                            '; filename=file' + FormData.LINE_BREAK +
                            'Content-Transfer-Encoding: binary' + FormData.LINE_BREAK +
                            'Content-Type: ' + response.headers['content-type'] +
                            '; name=file' + FormData.LINE_BREAK + FormData.LINE_BREAK
                    });
                    form.resume();
                }));
            });
        } else {
            saveLocation(req, model, function (loc) {
                res.json(loc);
            });
        }
    });
};

function saveLocation(req, model, cb) {
    var url = req.user.hereApiUrl('locations');

    function completion(json) {
        logger.debug('Saved location: %s', json);
        if (json.errorCode) {
            json.success = false;
        } else {
            json.success = true;
        }
        cb(json);
    }

    if (model.id) {
        logger.debug('Calling hereapi PUT location');
        req.user.hereApi().put({
            tokens: req.user.tokens(),
            json: true,
            url: url + '/' + model.id,
            payload: JSON.stringify(model),
            headers: {
                'Content-type': 'application/json'
            }
        }, req.$eat(completion));
    } else {
        logger.debug('Calling hereapi POST location');
        req.user.hereApi().post({
            tokens: req.user.tokens(),
            json: true,
            url: url,
            payload: JSON.stringify(model),
            headers: {
                'Content-type': 'application/json'
            }
        }, req.$eat(completion));
    }
}
