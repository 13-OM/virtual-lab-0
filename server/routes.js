// API route table — mirrors the previous backend's endpoints 1:1.
'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const Auth = require('./controllers/auth');
const Practical = require('./controllers/practicals');
const Progress = require('./controllers/progress');
const Admin = require('./controllers/admin');

const router = express.Router();

// ---------------- health ----------------
router.get('/health', (req, res) => {
  res.json({ ok: true, db: true, app: require('./config').APP_VERSION, time: Math.floor(Date.now() / 1000) });
});

// ---------------- auth ----------------
router.post('/auth/register', Auth.register);
router.post('/auth/login', Auth.login);
router.post('/auth/logout', requireAuth, Auth.logout);
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user, csrf: req.session.csrf });
});
router.post('/auth/change-password', requireAuth, Auth.changePassword);

// ---------------- student practicals (read-only) ----------------
router.get('/practicals', requireAuth, Practical.list);
router.get('/practicals/:id', requireAuth, Practical.get);

// ---------------- progress ----------------
router.get('/progress', requireAuth, Progress.list);
router.post('/progress', requireAuth, Progress.save);

// ---------------- admin ----------------
router.get('/admin/stats', requireAdmin, Admin.stats);
router.get('/admin/activities', requireAdmin, Admin.activities);
router.get('/admin/students', requireAdmin, Admin.students);
router.get('/admin/students/:id/details', requireAdmin, Admin.studentDetails);
router.get('/admin/enrollments', requireAdmin, Admin.enrollments);
router.post('/admin/enrollments/import', requireAdmin, Admin.importEnrollments);
router.delete('/admin/enrollments/:id', requireAdmin, Admin.enrollmentDelete);

router.get('/admin/practicals', requireAdmin, Admin.practicals);
router.post('/admin/practicals', requireAdmin, Admin.practicalCreate);   // create OR reorder {ids}
router.put('/admin/practicals', requireAdmin, Admin.reorder);           // reorder {ids}

router.get('/admin/practicals/:id', requireAdmin, Admin.practicalGet);
router.put('/admin/practicals/:id', requireAdmin, Admin.practicalUpdate);
router.delete('/admin/practicals/:id', requireAdmin, Admin.practicalDelete);

router.get('/admin/practicals/:id/history', requireAdmin, Admin.history);
router.post('/admin/practicals/:id/restore', requireAdmin, Admin.restore);

router.post('/admin/students/:id/reset-password', requireAdmin, Admin.studentResetPassword);
router.delete('/admin/students/:id', requireAdmin, Admin.studentDelete);

module.exports = router;
