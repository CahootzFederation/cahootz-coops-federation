import { ArrowRight, Clock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { formatPostDate } from "@/lib/blog";
import type { BlogPost } from "@/lib/blog";

interface BlogCardProps {
  post: BlogPost;
  priority?: boolean;
}

export function BlogCard({ post, priority = false }: BlogCardProps) {
  return (
    <article className="group overflow-hidden rounded-lg border border-white/10 bg-[#111111] transition hover:-translate-y-0.5 hover:border-[#f59e0b]/50">
      <Link href={`/blog/${post.slug}`} className="block">
        <div className="relative aspect-[16/9] overflow-hidden bg-[#1b1b1b]">
          <Image
            src={post.image}
            alt={post.imageAlt}
            fill
            className="object-cover opacity-85 transition duration-500 group-hover:scale-105 group-hover:opacity-100"
            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
            priority={priority}
          />
          <div className="absolute left-4 top-4 rounded-md bg-[#111111]/85 px-3 py-1 text-xs font-bold uppercase tracking-widest text-[#facc15] backdrop-blur">
            {post.category}
          </div>
        </div>
      </Link>

      <div className="p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
          <time dateTime={post.submittedAt ?? post.publishedAt}>
            {formatPostDate(post.submittedAt ?? post.publishedAt)}
          </time>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {post.readingTime}
          </span>
        </div>

        <h3 className="mt-3 text-xl font-black leading-tight text-white group-hover:text-[#facc15]">
          <Link href={`/blog/${post.slug}`}>{post.title}</Link>
        </h3>
        <p className="mt-2 text-sm text-slate-400">Written by {post.author}</p>
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-400">
          {post.excerpt}
        </p>

        <Link
          href={`/blog/${post.slug}`}
          className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#facc15] transition hover:text-white"
        >
          Read post
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}
