import type { CommonsPost } from './api';
import { mergeFeedPosts, postsForCircle } from './circle-feed';

const post = (id: string, coopId: string, circleId?: string) =>
  ({ id, coopId, circleId }) as CommonsPost;

describe('postsForCircle', () => {
  const posts = [
    post('legacy', 'artists'),
    post('general', 'artists', 'general:artists'),
    post('garden', 'artists', 'garden-circle'),
    post('music', 'artists', 'music-circle'),
    post('other-common', 'cahootz', 'general:cahootz'),
  ];

  it('shows only the selected circle', () => {
    expect(postsForCircle(posts, 'artists', 'garden-circle').map((item) => item.id)).toEqual(['garden']);
  });

  it('treats legacy posts as General without including other circles', () => {
    expect(postsForCircle(posts, 'artists').map((item) => item.id)).toEqual(['legacy', 'general']);
  });
});

describe('mergeFeedPosts', () => {
  it('keeps a newly posted item first when an older request completes', () => {
    expect(mergeFeedPosts(
      [post('new', 'artists', 'general:artists')],
      [post('older', 'artists', 'general:artists')],
    ).map((item) => item.id)).toEqual(['new', 'older']);
  });

  it('does not duplicate a post returned by a later feed request', () => {
    expect(mergeFeedPosts(
      [post('new', 'artists', 'general:artists')],
      [post('new', 'artists', 'general:artists'), post('older', 'artists')],
    ).map((item) => item.id)).toEqual(['new', 'older']);
  });
});
