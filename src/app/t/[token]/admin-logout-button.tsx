"use client";

// 기능: 관리자 모드 화면의 로그아웃 버튼 (로그아웃 후 같은 URL 을 참가자 화면으로 다시 연다)
export function AdminLogoutButton() {
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.reload();
  }
  return (
    <button type="button" onClick={logout} className="ml-2 underline">
      관리자 로그아웃
    </button>
  );
}
