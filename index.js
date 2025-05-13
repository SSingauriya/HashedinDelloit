require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const ResourceLock = require('./models/ResourceLock');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// POST /locks/request: Request a lock on a resource
app.post('/locks/request', async (req, res) => {
  const { resource_name, process_id_str, ttl_seconds } = req.body;

  // Validate input
  if (!resource_name || !process_id_str) {
    return res.status(400).json({ error: 'resource_name and process_id_str are required' });
  }

  try {
    // Check if the resource is already locked
    let existingLock = await ResourceLock.findOne({ resource_name });

    // If lock exists, check if it has expired
    if (existingLock) {
      const currentTime = new Date();
      if (existingLock.expires_at && existingLock.expires_at < currentTime) {
        // Lock has expired, remove it
        await ResourceLock.deleteOne({ resource_name });
        existingLock = null;
      }
    }

    if (existingLock) {
      // Resource is locked by another process
      return res.status(409).json({
        status: 'denied',
        resource_name,
        locked_by: existingLock.process_id_str,
      });
    }

    // Create a new lock
    const locked_at = new Date();
    const expires_at = ttl_seconds ? new Date(locked_at.getTime() + ttl_seconds * 1000) : null;

    const newLock = new ResourceLock({
      resource_name,
      process_id_str,
      locked_at,
      expires_at,
    });

    await newLock.save();

    res.status(200).json({
      status: 'acquired',
      resource_name,
      process_id_str,
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error (race condition)
      const existingLock = await ResourceLock.findOne({ resource_name });
      return res.status(409).json({
        status: 'denied',
        resource_name,
        locked_by: existingLock.process_id_str,
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /locks/release: Release a lock on a resource
app.post('/locks/release', async (req, res) => {
  const { resource_name, process_id_str } = req.body;

  // Validate input
  if (!resource_name || !process_id_str) {
    return res.status(400).json({ error: 'resource_name and process_id_str are required' });
  }

  try {
    const existingLock = await ResourceLock.findOne({ resource_name });

    if (!existingLock) {
      return res.status(404).json({
        status: 'resource_not_locked',
        resource_name,
      });
    }

    if (existingLock.process_id_str !== process_id_str) {
      return res.status(403).json({
        status: 'not_locked_by_process',
        resource_name,
      });
    }

    await ResourceLock.deleteOne({ resource_name });

    res.status(200).json({
      status: 'released',
      resource_name,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /locks/status/:resource_name: Check if a resource is locked
app.get('/locks/status/:resource_name', async (req, res) => {
  const { resource_name } = req.params;

  try {
    const lock = await ResourceLock.findOne({ resource_name });

    if (!lock) {
      return res.status(200).json({
        resource_name,
        is_locked: false,
      });
    }

    // Check if the lock has expired
    const currentTime = new Date();
    if (lock.expires_at && lock.expires_at < currentTime) {
      await ResourceLock.deleteOne({ resource_name });
      return res.status(200).json({
        resource_name,
        is_locked: false,
      });
    }

    res.status(200).json({
      resource_name,
      is_locked: true,
      locked_by: lock.process_id_str,
      locked_at: lock.locked_at,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /locks/all-locked: List all locked resources
app.get('/locks/all-locked', async (req, res) => {
  try {
    const currentTime = new Date();
    const locks = await ResourceLock.find();

    // Filter out expired locks
    const validLocks = [];
    for (const lock of locks) {
      if (lock.expires_at && lock.expires_at < currentTime) {
        await ResourceLock.deleteOne({ resource_name: lock.resource_name });
      } else {
        validLocks.push({
          resource_name: lock.resource_name,
          locked_by: lock.process_id_str,
          locked_at: lock.locked_at,
        });
      }
    }

    res.status(200).json(validLocks);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /locks/process/:process_id_str: List resources locked by a specific process
app.get('/locks/process/:process_id_str', async (req, res) => {
  const { process_id_str } = req.params;

  try {
    const currentTime = new Date();
    const locks = await ResourceLock.find({ process_id_str });

    // Filter out expired locks
    const validLocks = [];
    for (const lock of locks) {
      if (lock.expires_at && lock.expires_at < currentTime) {
        await ResourceLock.deleteOne({ resource_name: lock.resource_name });
      } else {
        validLocks.push({
          resource_name: lock.resource_name,
          locked_at: lock.locked_at,
        });
      }
    }

    res.status(200).json(validLocks);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Lock Manager running on http://localhost:${port}`);
});