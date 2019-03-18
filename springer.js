createPage = async (browser) => {
    const page = await browser.newPage();

    // Science direct does not allow headless browsers... but if chrome introduce itself as non headless browser...
    const headlessUserAgent = await page.evaluate(() => navigator.userAgent);
    const chromeUserAgent = headlessUserAgent.replace('HeadlessChrome', 'Chrome');
    await page.setUserAgent(chromeUserAgent);
    await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.8'
    });

    await page.setJavaScriptEnabled(true);
    const VIEWPORT = {width: 1920, height: 1080};
    await page.setViewport(VIEWPORT);

    return page
};

fetchAuthorsFromSite = async (url, page) => {
    await page.goto(url);
    let authors = [];

    const title = await (await (await page.$$('.ArticleTitle'))[0].getProperty('innerText')).jsonValue();

    const authorsWithEmail = await page.$$('.authors__contact');

    try {
        for (let authorElement of authorsWithEmail) {
            const parent = await page.evaluateHandle(el => el.parentElement, authorElement);
            const parentofParent = await page.evaluateHandle(el => el.parentElement, parent);
            const name = await (await parentofParent.getProperty('innerText')).jsonValue();

            const emailField = await page.evaluateHandle(el => el.children[0], authorElement);
            const email = await (await emailField.getProperty('title')).jsonValue();

            authors.push({
                name: name.trim(),
                email: email.trim(),
                affiliation: "",
                source: title,
                url: url
            });
        }
    } catch (e) {
        // Catch other errors
        console.error(`Something wrong with: ${url}`)
    }


    return authors
};


getPapersLinksFromPage = async (page) => {
    const elements = await page.$$('.title > a');
    let urls = [];
    for (let element of elements) {
        const href = await element.getProperty('href');
        urls.push(await href.jsonValue());
    }
    return urls
};

getEmailsFromUrl = async (url) => {
    const puppeteer = require('puppeteer');

    const browser = await puppeteer.launch({
        // headless: false,
        args: ["--start-maximized"],
    });

    let authors = [];
    let page = await createPage(browser);
    await page.goto(url)

    let urls = await getPapersLinksFromPage(page);
    for (const url of urls) {
        let paperPage = await createPage(browser);
        console.log(`=> ${url}`);
        try {
            let newAuthors = await fetchAuthorsFromSite(url, paperPage);
            console.log(newAuthors);
            authors = [...authors, ...newAuthors];
            await paperPage.close();
        } catch (e) {
            console.log(e.message)
        }

    }

    authors = [...new Set(authors)];
    await browser.close();
    return authors
}


saveToDatabase = (records, journal) => {
    const sqlite3 = require('sqlite3').verbose();
    let db = new sqlite3.Database('./emails.db', (err) => {
        if (err) {
            return console.error(err.message);
        }
        console.log('Connected to the SQlite database.');
    });

    db.run("CREATE TABLE IF NOT EXISTS \"emails\" (\n" +
        "  ID INTEGER PRIMARY KEY AUTOINCREMENT,\n" +
        "  name TEXT,\n" +
        "  email TEXT NOT NULL UNIQUE,\n" +
        "  affiliation TEXT,\n" +
        "  source TEXT,\n" +
        "  url TEXT,\n" +
        "  journal TEXT,\n" +
        "  CONSTRAINT unique_email UNIQUE (email ASC) ON CONFLICT IGNORE\n" +
        ");");

    for (const rec of records) {
        db.run('INSERT INTO "main"."emails"("name", "email", "affiliation", "source", "url", "journal")  VALUES (?, ?, ?, ?, ?, ?)', [rec.name, rec.email, rec.affiliation, rec.source, rec.url, journal], err => {
            if (err) console.error(err.message);
        })
    }

    db.close();
}

(async () => {
    const journals = require('./springer_journals')

    for (let journal of journals) {
        for (let n = journal.volStart; n <= journal.volEnd; ++n) {
            for (let issue = 1; issue <= 12; ++issue) {
                const baseUrl = journal.url;
                let volUrl = baseUrl.replace('{vol}', n);
                let issueUrl = volUrl.replace('{issue}', issue);
                const authors = await getEmailsFromUrl(issueUrl)
                saveToDatabase(authors, journal.name)
            }
        }
    }

})();