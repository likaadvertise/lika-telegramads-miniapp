/* مسیرهای یک سفارش مشخص: /api/admin/campaign/LK-1044 (ویرایش، حذف)
   و /api/admin/campaign/LK-1044/stats (ثبت آمار). چون بیش از یک بخش
   بعد از campaign/ دارند، باید catch-all باشند — همان محدودیت بالا. */
export { default } from "../../../server/src/vercel-handler.js";
