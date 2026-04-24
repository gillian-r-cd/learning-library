import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md p-10 text-center space-y-4">
      <h1 className="text-2xl font-bold">页面未找到</h1>
      <p className="text-sm text-muted">链接可能过期或资源已删除。</p>
      <Link href="/" className="btn-primary inline-block">返回首页</Link>
    </div>
  );
}
