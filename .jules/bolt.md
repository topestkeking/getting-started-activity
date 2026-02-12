## 2025-05-15 - [Native Fetch & CLS Optimizations]
**Learning:** Native fetch in Node 18+ (especially Node 22) is more efficient than node-fetch due to built-in connection pooling and lack of wrapper overhead. Also, explicit image dimensions in vanilla HTML are crucial for preventing CLS.
**Action:** Always prefer native fetch in Node.js environments and ensure all images have defined dimensions.
