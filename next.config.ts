import type {NextConfig} from 'next';
const security=[
 {key:'X-Content-Type-Options',value:'nosniff'},
 {key:'X-Frame-Options',value:'DENY'},
 // One-time invitation/reset tokens travel in URL fragments; never leak page URLs to other origins.
 {key:'Referrer-Policy',value:'no-referrer'},
 {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
];
const config:NextConfig={turbopack:{root:process.cwd()},devIndicators:false,poweredByHeader:false,async headers(){return [
 {source:'/:path*',headers:security},
 // Attachment downloads set their own stricter sandbox CSP in the route handler.
 {source:'/((?!api/v1/attachments/).*)',headers:[{key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"}]},
];}};
export default config;
