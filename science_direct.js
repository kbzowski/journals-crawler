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
    // page.waitFor(3000);
    // await page.screenshot({path: 'screenshot.png'});


    const elements = await page.$$('.author');
    let authors = [];

    try {
        for (let element of elements) {
            // Skip NOT-authors
            const classes = await (await element.getProperty('className')).jsonValue();
            if (classes.includes("abstract")) continue;

            // click on author anchor
            await element.click();

            // Get info
            const name = await (await (await page.$$('#workspace-author > div.author'))[0].getProperty('innerText')).jsonValue();
            const affiliation = await (await (await page.$$('#workspace-author > div.affiliation'))[0].getProperty('innerText')).jsonValue();
            const title = await (await (await page.$$('.title-text'))[0].getProperty('innerText')).jsonValue();

            let email = null;
            try {
                email = await (await (await page.$$('#workspace-author > div.e-address'))[0].getProperty('innerText')).jsonValue();
                authors.push({
                    name: name.trim(),
                    email: email.trim(),
                    affiliation: affiliation.trim(),
                    source: title.trim(),
                    url
                });
            } catch (e) {
                // There is no email - so that entry is useless
            }
        }
    } catch (e) {
        // Catch other errors
        console.error(`Something wrong with: ${url}`)
    }

    return authors
};


searchByKeywords = async (page, keywords, pagenum) => {
    // await page.goto("https://www.sciencedirect.com/")
    // const inputText = keywords.join(', ')
    //
    // await page.evaluate((inputText) => {
    //     document.querySelector('input[name="qs"]').value = inputText;
    // }, inputText);
    //
    // await (await page.$('input[name="qs"]')).press('Enter');

    const offset = pagenum * 100;
    const sortby = 'relevance'
    const url = `https://www.sciencedirect.com/search?qs=${keywords}&show=100&sortBy=${sortby}&offset=${offset}`;
    console.log(`===> ${url}`)
    await page.goto(url)
};

isNextPage = async (page) => {
    return page.evaluate(async () => {
        let elements = await document.getElementsByClassName('next-link');
        if (elements.length === 0) return false;
        return true
    });

};

getPapersLinksFromPage = async (page) => {
    const elements = await page.$$('.article-content-title');
    let urls = [];
    for (let element of elements) {
        const href = await element.getProperty('href');
        urls.push(await href.jsonValue());
    }
    return urls
};

const MAX_PAGE = 10000;

getEmailsForKeyword = async (keyword) => {
    const puppeteer = require('puppeteer');

    const browser = await puppeteer.launch({
        // headless: false,
        args: ["--start-maximized"],
    });

    let authors = [];
    let page = await createPage(browser);
    let p = 0;

    while (p < MAX_PAGE) {
        await searchByKeywords(page, keyword, p)
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

        if (await isNextPage(page))
            p++;
        else
            break;
    }

    authors = [...new Set(authors)];
    await browser.close();
    return authors
}


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

saveToCsv = async (records, filename) => {
    const createCsvWriter = require('csv-writer').createObjectCsvWriter;

    const csvWriter = createCsvWriter({
        path: filename,
        header: [
            {id: 'name', title: 'name'},
            {id: 'email', title: 'email'}
        ],
        fieldDelimiter: ';'
    });

    return csvWriter.writeRecords(records)       // returns a promise

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
    const asTable = require('as-table').configure({dash: '', delimiter: '\t'});
    const fs = require('fs');
    const journals = require('./journals')

    for (let journal of journals) {
        if (journal.urls) {
            for (let url of journal.urls) {
                const authors = await getEmailsFromUrl(url)
                saveToDatabase(authors, journal.name)
            }
        } else {
            for(let n = journal.volStart; n<=journal.volEnd; ++n){
                let volUrl = journal.url.replace('{vol}', n);
                const authors = await getEmailsFromUrl(volUrl)
                saveToDatabase(authors, journal.name)
            }
        }

    }

    // for (let num = 81; num <= 162; num++) {
    //     // const authors = await getEmailsForKeyword(key)
    //     const url = `https://www.sciencedirect.com/journal/computational-materials-science/vol/${num}/suppl/C`
    //
    //     const authors = await getEmailsFromUrl(url)
    //     const filename = 'computational-materials-science-' + num;
    //     fs.writeFileSync(filename + '.txt', asTable(authors));
    //
    //     await saveToCsv(authors, filename + '.csv');
    //
    //     let journal = 'Computational Materials Science'
    //     saveToDatabase(authors, journal)
    // }
})();