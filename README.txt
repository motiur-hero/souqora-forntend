SOUQORA - DECAP CMS PATCH

Included:
- index.html: latest index(6).html with only the script version reference adjusted.
- js/script.js: script(4).js adjusted to load content/products.json when deployed.
- content/products.json: current 36 products migrated from index(6).html.
- admin/index.html: Decap CMS loader.
- admin/config.yml: Decap CMS product fields.

IMPORTANT:
1. Replace the existing deployed index.html with this index.html.
2. Replace js/script.js with this script.js.
3. Add content/products.json.
4. Add the admin folder.
5. In admin/config.yml replace:
   motiur-hero/REPLACE_WITH_YOUR_REPOSITORY_NAME
   with your exact GitHub repository name.
6. Because the GitHub backend needs authentication, complete the Netlify/Decap authentication setup before using /admin/ in production.

Mobile/cart/detail/checkout behavior:
- Existing responsive HTML/CSS is preserved.
- Existing cart/localStorage logic is preserved.
- Existing product detail/landing page logic is preserved.
- Existing order/Google Sheets logic is preserved.
- If content/products.json cannot be loaded (for example when opening index.html directly with file://), the original HTML product cards remain the fallback.
