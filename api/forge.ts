import { createHostingHandler } from '../server/hosting.js';

// No listener or file-backed database is created inside a Vercel function.
export default createHostingHandler();
