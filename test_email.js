import 'dotenv/config';
import nodemailer from 'nodemailer';

async function test() {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: (process.env.SMTP_PORT === '465' || !process.env.SMTP_PORT), 
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    let info = await transporter.sendMail({
      from: `"Zundamon Bot" <${process.env.SMTP_USER}>`,
      to: process.env.OWNER_EMAIL,
      subject: `[Zundamon] Test Email`,
      text: `Test email from the bot.`,
    });
    console.log('Success:', info.messageId);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
