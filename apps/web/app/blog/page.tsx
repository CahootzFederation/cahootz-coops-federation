import type { Metadata } from "next";

import { BlogCard } from "@/components/blog/blog-card";
import { SiteShell } from "@/components/blog/site-shell";
import { getPublishedBlogPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog | Cahootz",
  description:
    "Updates, product notes, and practical writing on community-owned economies, commons governance, and local commerce.",
  alternates: {
    canonical: "https://cahootz.coop/blog",
  },
};

export default function BlogPage() {
  const posts = getPublishedBlogPosts();

  return (
    <SiteShell>
      <main>
        <section className="border-b border-white/10 px-5 py-16 sm:px-6 md:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-widest text-[#facc15]">
                Cahootz Blog
              </p>
              <h1 className="mt-4 text-4xl font-black tracking-tight md:text-6xl">
                Notes on building community-owned economies.
              </h1>
              <p className="mt-5 text-lg leading-8 text-slate-400">
                Product updates, founder thinking, commons playbooks, and practical
                essays drafted in Notion and published here where the community can
                find them.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-[#161616] px-5 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-7xl">
            {posts.length > 0 ? (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {posts.map((post, index) => (
                  <BlogCard key={post.slug} post={post} priority={index === 0} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-sm font-bold uppercase tracking-widest text-[#facc15]">Coming soon</p>
                <h2 className="mt-4 text-2xl font-black tracking-tight md:text-4xl">No posts yet.</h2>
                <p className="mt-4 max-w-md text-slate-400">
                  We&apos;re working on it. Check back soon for product updates, commons playbooks,
                  and practical writing on community-owned economies.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
