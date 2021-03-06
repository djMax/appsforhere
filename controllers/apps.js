'use strict';
var appUtils = require('../lib/appUtils');

module.exports = function (router) {

    router.use(appUtils.domain);

    /**
     * Simple render for the admin base page
     */
    router.get('/', appUtils.auth, appUtils.render('apps/index'));

};
