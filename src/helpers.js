// src/helpers.js - small shared functions used by the routes
const today = () => new Date().toISOString().slice(0, 10);
const pkgLabel = p => (p ? `${p.name} - ${p.channels}+ Channels` : 'No package');

const isMobile = m => /^\d{10}$/.test(String(m || ''));
const posInt = n => Number.isInteger(Number(n)) && Number(n) > 0;
const cleanText = (s, max) => String(s || '').trim().slice(0, max);
const MONTH_RE = /^[A-Za-z]{3,9} \d{4}$/;

// customer + readable package name and price
const withPackage = (d, c) => {
  const p = d.packages.find(x => x.id === c.packageId);
  return { ...c, package: pkgLabel(p), packagePrice: p ? p.price : 0 };
};

// Marks a bill paid and writes the payment record (used by app + operator)
function recordPayment(d, bill, method, source) {
  bill.status = 'Paid';
  bill.paidDate = today();
  const pay = {
    id: d.nextPaymentId++, billId: bill.id, customerId: bill.customerId, amount: bill.amount,
    method, date: today(), txnId: 'ST' + Date.now().toString(36).toUpperCase(), source
  };
  d.payments.push(pay);
  return pay;
}

module.exports = { today, pkgLabel, isMobile, posInt, cleanText, MONTH_RE, withPackage, recordPayment };
