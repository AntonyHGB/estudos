export const clean=s=>String(s??'').replace(/<[^>]*>/g,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[`*_~#]/g,'').replace(/\s+/g,' ').trim();
