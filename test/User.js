import _ from 'lodash' // eslint-disable-line
import moment from 'moment'
import Backbone from 'backbone'
import {smartSync} from 'fl-server-utils'
import bcrypt from 'bcrypt-nodejs'

let Profile = null

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) console.log('Missing process.env.DATABASE_URL')

export default class User extends Backbone.Model {
  url = `${dbUrl}/users`

  schema = () => _.extend({

    accessTokens: () => ['hasMany', require('fl-auth-server').AccessToken],
    // todo
    // refreshTokens: () => ['hasMany', require('fl-auth-server').RefreshToken],

    profile: () => ['hasOne', Profile = require('./Profile')],

  }, require('../../shared/models/schemas/user'))

  static createHash(password) { return bcrypt.hashSync(password) }

  defaults() { return {createdDate: moment.utc().toDate()} }

  onCreate(callback) {
    const profile = new Profile({user: this})
    profile.save(callback)
  }

  passwordIsValid(password) { return bcrypt.compareSync(password, this.get('password')) }
}

User.prototype.sync = smartSync(dbUrl, User)
