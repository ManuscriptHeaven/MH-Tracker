/** Business-facing invoice identity and payment copy, centralized for future settings support. */
export const invoiceConfig = {
  businessName: 'Manuscript Heaven',
  email: 'hello@manuscriptheaven.com',
  website: 'www.manuscriptheaven.com',
  phone: '+1 (844) 687-0111',
  address: '3031 Tisch Way, Suite 110, San Jose, CA 95128',
  footerThankYou: 'Thank you for your business!',
  currency: 'USD',
  defaultPaymentTerms: 'Net 14',
  paymentDetailsPlaceholder: 'Payment details will be shared upon request.',
  latePaymentNoteEnabled: false,
  latePaymentNote: 'Late payments may be subject to additional fees.',
} as const;

