/** Safe authentication failures: never return upstream text or credential values. */
export function authenticationFailure(status, code) {
  if (status === 429 || code === "over_request_rate_limit")
    return {
      status: 429,
      message: "محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً",
    };
  if (code === "invalid_credentials")
    return {
      status: 401,
      message:
        "البريد الإلكتروني أو كلمة المرور غير صحيحة. استخدم حساب موقع الموارد البشرية",
    };
  if (code === "email_not_confirmed")
    return {
      status: 403,
      message: "البريد الإلكتروني غير مؤكد. راجع مسؤول الحساب لتفعيل الدخول",
    };
  if (code === "user_banned")
    return {
      status: 403,
      message: "الوصول لهذا الحساب موقوف. راجع مسؤول الحساب",
    };
  return {
    status: 503,
    message:
      "تعذر إكمال تسجيل الدخول حالياً. حاول مرة أخرى؛ لا يلزم تغيير كلمة المرور",
  };
}
