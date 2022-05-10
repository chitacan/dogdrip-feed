import got from 'got';
import * as cheerio from 'cheerio';
import { Feed } from 'feed';
import { readFileSync, existsSync, writeFileSync } from 'fs';

const HOST = 'https://www.dogdrip.net';

const headers = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36'
};

const INTERVAL = 300;
const FEED_FILE = 'feed.json';

const fetchComments = async (url, header) => {
  const u = new URL(url);
  const [, id] = u.pathname.split('/');
  const {error, message, html} = await got.post(HOST, {
    headers,
    form: {
      document_srl: id,
      cpage: 1,
      module: 'board',
      act: 'getBoardCommentsData',
      _rx_ajax_compat: 'JSON'
    }
  }).json();

  if (error == -1) {
    throw new Error(message);
  }
  return html;
}

const getComments = (comments) => {
  const $ = cheerio.load(comments);
  const result = $('.comment-list').html();

  if (result) {
    return `<hr/>
${result}`;
  }

  return '';
};

const getArticle = async (url) => {
  const res = await got(url, {headers});
  const $ = cheerio.load(res.body);

  const [cookie] = res.headers['set-cookie'].find(d => d.startsWith('PHPSESSID')).split(';');
  const csrfToken = $('head > meta[name="csrf-token"]').attr('content');

  const commentHTML = await fetchComments(url, {
      'x-csrf-token': csrfToken,
      cookie: `${cookie};`
    })
    .catch(() => $('#commentbox').html());
  const comments = getComments(commentHTML);

  const article$ = $('#article_1');
  article$.find('img.lazy, video:empty, source').each((i, elem) => {
    const pathname = $(elem).attr('data-src');
    const url = new URL(HOST);
    url.pathname = pathname;

    $(elem).attr('src', url.toString());
  });

  return `${article$.html()}

${comments}`;
};

const getArticles = async (url) => {
  const doc = await got(url, {headers}).text();
  const $ = cheerio.load(doc);
  const list = $('tbody > tr:not(.notice)', 'main table')

  const result = [];
  for (const elem of list) {
    const tr = $(elem)
    const title$ = tr.find('.title');
    const href = title$.find('a').attr('href');
    const title = title$.find('.title-link').text();
    const comment = title$.find('.title-link + span').text();

    const author$ = tr.find('.author');
    const author = author$.text().trim();
    const level = author$.find('img').attr('title');
    const levelImg = author$.find('img').attr('src');

    const vote = tr.find('.voteNum').text().trim();

    await new Promise(resolve => setTimeout(() => resolve(), INTERVAL));

    const content = await getArticle(href).catch(() => href);

    result.push({
      title,
      id: href,
      link: href,
      description: '',
      content,
      author: [{
        name: author,
        link: ''
      }],
      date: ''
    });
  }

  return result;
};

const hasArticle = (articles, id) => !!articles.find(article => article.id === id);

const generateFeed = async (title, url) => {
  const feed = new Feed({
    title,
    description: "chitacan's personal dogdrip feed",
    id: url,
    link: url,
    image: "https://www.dogdrip.net/files/attach/xeicon/mobicon.png",
    updated: new Date(),
    feedLinks: {
      json: ""
    },
    author: {
      name: "chitacan",
      email: "chitacan@gmail.com",
      link: "https://github.com/chitacan"
    }
  });

  console.log('fetching latest');
  const articles = await getArticles(url);

  for (const article of articles) {
    feed.addItem(article)
  }

  if (existsSync(FEED_FILE)) {
    const {items: [{id: lastArticleId}]} = JSON.parse(readFileSync(FEED_FILE));
    console.log(`lastArticleId: ${lastArticleId}`);

    if (hasArticle(articles, lastArticleId)) {
      console.log('lastArticleId in latest');
      return feed.json1();
    } else {
      console.log('no lastArticleId in latest');
      for (const page of [2, 3, 4, 5, 6]) {
        console.log(`fetching page: ${page}`);
        const articles = await getArticles(`${url}?page=${page}`);
        const pageHasArticle = hasArticle(articles, lastArticleId);
        for (const article of articles) {
          if (pageHasArticle && article.id === lastArticleId) {
            break;
          }
          feed.addItem(article)
        }
        return feed.json1();
      }
    }
  }

  return feed.json1();
}

const result = await generateFeed('dogdrip', 'https://www.dogdrip.net/dogdrip');
writeFileSync(FEED_FILE, result);
