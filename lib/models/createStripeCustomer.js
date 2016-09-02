'use strict';

var _inherits = require('babel-runtime/helpers/inherits')['default'];

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var _interopRequireDefault = require('babel-runtime/helpers/interop-require-default')['default'];

exports.__esModule = true;
exports['default'] = createStripeCustomer;

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

// eslint-disable-line

var _moment = require('moment');

var _moment2 = _interopRequireDefault(_moment);

var _backbone = require('backbone');

var _backbone2 = _interopRequireDefault(_backbone);

var _flServerUtils = require('fl-server-utils');

var dbUrl = process.env.DATABASE_URL;
if (!dbUrl) console.log('Missing process.env.DATABASE_URL');

function createStripeCustomer(User) {
  var StripeCustomer = (function (_Backbone$Model) {
    _inherits(StripeCustomer, _Backbone$Model);

    function StripeCustomer() {
      _classCallCheck(this, StripeCustomer);

      _Backbone$Model.apply(this, arguments);

      this.url = dbUrl + '/stripeCustomer';

      this.schema = function () {
        return {
          stripeId: 'String',
          user: function user() {
            return ['belongsTo', User];
          }
        };
      };
    }

    StripeCustomer.prototype.defaults = function defaults() {
      return { createdDate: _moment2['default'].utc().toDate() };
    };

    return StripeCustomer;
  })(_backbone2['default'].Model);

  StripeCustomer.prototype.sync = _flServerUtils.smartSync(dbUrl, StripeCustomer);

  return StripeCustomer;
}

module.exports = exports['default'];