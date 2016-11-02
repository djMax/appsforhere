/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2016 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';

// Adapted from
//  https://github.com/willmark/img-canvas-helper/blob/master/index.js
// so that we can install canvas globally and avoid build issues
var log = require('pine')();
var imageType = require('image-type');
var Lwip;

try {
    Lwip = require('lwip');
} catch (x) {
    log.error('Could not load lwip - image scaling not available.', x);
}

var Args = require('vargs').Constructor;

/**
 * Resizes an image where longest dimension is the shortest of width/height
 * imgsrc - string path to image to crop
 * width - integer length of longest width dimension for resized image
 * height - integer length of longest height dimension for resized image
 * callback - callback function(
 *     result - boolean true on success
 *     data - canvas object on success, Error on failure
 */
var resize = function (imgsrc, width, height, callback) {

    var args = new Args(arguments);
    checkCommonArgs(args);

    Lwip.open(imgsrc, imageType(imgsrc), function (err, img) {
       if (err) {
           callback(err);
           return;
       }
       var ratio = Math.min(
               Math.min(img.width(), width) / Math.max(img.width(), width),
               Math.min(img.height(), height) / Math.max(img.height(), height)
       );

        var w = Math.round(ratio * img.width(), 0);
        var h = Math.round(ratio * img.height(), 0);

        img.resize(w, h, function (resizeError, resizeImage) {
            if (resizeImage) {
                resizeImage.src = imgsrc;
            }
            callback(resizeError, resizeImage);
        });

    });
};

/**
 * Common argument checking for crop and resize
 */
function checkCommonArgs(args) {
    if (args.length < 3) {
        throw new Error('imgsrc, width, height, and callback required');
    }
    if (typeof args.at(2) !== 'number') {
        throw new Error('height required int parameter');
    }
    if (typeof args.at(1) !== 'number') {
        throw new Error('width required int parameter');
    }
    if (!args.callbackGiven()) {
        throw new Error('Callback required');
    }
}

module.exports = {
    resize: resize
};
