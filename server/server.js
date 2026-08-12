require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

// Must run before mongoose tries to resolve the mongodb+srv:// SRV record.
require('./config/dns').applyDnsServers();

const authRoutes = require('./routes/auth');
const marshalRoutes = require('./routes/marshalRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/marshal', marshalRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, dbState: mongoose.connection.readyState });
});

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'lineup';

mongoose
  .connect(MONGO_URI, { dbName: MONGO_DB_NAME })
  .then(() => {
    console.log(`Connected to MongoDB database "${MONGO_DB_NAME}"`);
    app.listen(PORT, () => console.log(`Marshal Lineup System running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
