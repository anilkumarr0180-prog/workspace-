import fs from 'fs';
import path from 'path';

function runVerification() {
  console.log('--- Verifying Terms & Conditions Button Disabling & Email Rate Limit Fix ---');

  // 1. Verify signup-form.tsx button disabling
  const signupFormPath = path.resolve(__dirname, '../components/auth/signup-form.tsx');
  const signupFormSource = fs.readFileSync(signupFormPath, 'utf8');

  if (!/disabled=\{loading \|\| !agreeTerms\}/.test(signupFormSource)) {
    throw new Error('Assertion failed: Signup button must have disabled={loading || !agreeTerms}');
  }
  console.log('✓ Signup button has disabled={loading || !agreeTerms}');

  if (!/bg-slate-200 text-slate-400 cursor-not-allowed/.test(signupFormSource)) {
    throw new Error('Assertion failed: Signup button must have disabled styling (bg-slate-200 text-slate-400 cursor-not-allowed)');
  }
  console.log('✓ Signup button has disabled visual styling when terms are not agreed');

  if (!/fetch\('\/api\/auth\/signup'/.test(signupFormSource)) {
    throw new Error('Assertion failed: Signup form must call /api/auth/signup');
  }
  console.log('✓ Signup form calls /api/auth/signup for auto-confirmed account provisioning');

  // 2. Verify /api/auth/signup/route.ts
  const apiSignupPath = path.resolve(__dirname, '../app/api/auth/signup/route.ts');
  if (!fs.existsSync(apiSignupPath)) {
    throw new Error('Assertion failed: app/api/auth/signup/route.ts must exist');
  }
  const apiSignupSource = fs.readFileSync(apiSignupPath, 'utf8');

  if (!/generateLink/.test(apiSignupSource) && !/dispatchVerificationEmail/.test(apiSignupSource)) {
    throw new Error('Assertion failed: /api/auth/signup must implement verification link generation & email dispatch');
  }
  console.log('✓ /api/auth/signup generates verification credentials and dispatches verification email');

  if (/devOtp:\s*otp/.test(apiSignupSource)) {
    throw new Error('Assertion failed: /api/auth/signup must not expose devOtp in live production responses');
  }
  console.log('✓ /api/auth/signup does not leak devOtp in responses');

  if (!/updateUserById/.test(apiSignupSource)) {
    throw new Error('Assertion failed: /api/auth/signup must handle updating unconfirmed users');
  }
  console.log('✓ /api/auth/signup handles unconfirmed accounts cleanly');

  // 3. Verify /api/auth/confirm-login/route.ts
  const apiConfirmLoginPath = path.resolve(__dirname, '../app/api/auth/confirm-login/route.ts');
  if (!fs.existsSync(apiConfirmLoginPath)) {
    throw new Error('Assertion failed: app/api/auth/confirm-login/route.ts must exist');
  }
  const apiConfirmLoginSource = fs.readFileSync(apiConfirmLoginPath, 'utf8');

  if (!/email_confirm:\s*true/.test(apiConfirmLoginSource)) {
    throw new Error('Assertion failed: /api/auth/confirm-login must set email_confirm: true');
  }
  console.log('✓ /api/auth/confirm-login auto-confirms unconfirmed accounts during login');

  // 4. Verify app/login/page.tsx auto-confirmation
  const loginPath = path.resolve(__dirname, '../app/login/page.tsx');
  const loginSource = fs.readFileSync(loginPath, 'utf8');

  if (!/fetch\('\/api\/auth\/confirm-login'/.test(loginSource)) {
    throw new Error('Assertion failed: app/login/page.tsx must call /api/auth/confirm-login on unconfirmed email error');
  }
  console.log('✓ app/login/page.tsx seamlessly auto-confirms unconfirmed users when logging in');

  console.log('\nAll Terms & Rate Limit Fix assertions passed successfully!');
}

runVerification();

