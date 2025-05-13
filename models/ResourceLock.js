const mongoose = require('mongoose');

const ResourceLockSchema = new mongoose.Schema({
  resource_name: {
    type: String,
    required: true,
    unique: true, // Ensures a resource can only have one active lock
  },
  process_id_str: {
    type: String,
    required: true,
  },
  locked_at: {
    type: Date,
    default: Date.now, // Automatically set to current timestamp when lock is acquired
  },
  expires_at: {
    type: Date,
    default: null, // Optional expiration timestamp
  },
});

module.exports = mongoose.model('ResourceLock', ResourceLockSchema);