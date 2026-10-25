const express = require('express');
const multer = require('multer');
const { monitor } = require('../controllers/monitorController');

const router = express.Router();

// Memory storage for uploaded JSON files (we parse and discard)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are allowed'), false);
    }
  }
});

/**
 * POST /monitor
 * Accepts either:
 *   - application/json body: a JSON array of API response objects
 *   - multipart/form-data with a "file" field containing a JSON file
 */
router.post('/', upload.single('file'), express.json({ limit: '2mb' }), monitor);

module.exports = router;
