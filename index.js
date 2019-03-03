createPage = async(browser) => {
    const page = await browser.newPage();

    // Science direct does not allow headless browsers... but if chrome introduce itself as non headless browser...
    const headlessUserAgent = await page.evaluate(() => navigator.userAgent);
    const chromeUserAgent = headlessUserAgent.replace('HeadlessChrome', 'Chrome');
    await page.setUserAgent(chromeUserAgent);
    await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.8'
    });

    await page.setJavaScriptEnabled(true);
    const VIEWPORT = { width: 1920, height: 1080 };
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
            if(classes.includes("abstract")) continue;

            // click on author anchor
            await element.click();

            // Get info
            const name = await (await (await page.$$('#workspace-author > div.author'))[0].getProperty('innerText')).jsonValue();
            const affiliation = await (await (await page.$$('#workspace-author > div.affiliation'))[0].getProperty('innerText')).jsonValue();

            let email = null;
            try {
                email = await (await (await page.$$('#workspace-author > div.e-address'))[0].getProperty('innerText')).jsonValue();
                authors.push({
                    name: name.trim(),
                    email: email.trim(),
                    affiliation: affiliation.trim(),
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

    const inputText = keywords.join(', ');
    const offset = pagenum * 100;
    const url = `https://www.sciencedirect.com/search?qs=${inputText}&show=100&sortBy=date&offset=${offset}`;
    await page.goto(url)
};

isNextPage = async (page) => {
    return page.evaluate(async () => {
        let elements = await document.getElementsByClassName('next-link');
        if(elements.length === 0) return false;
        return true
    });

};

getPapersLinks = async (page) => {
    const elements = await page.$$('.result-list-title-link');
    let urls = [];
    for (let element of elements) {
        const href = await element.getProperty('href');
        urls.push(await href.jsonValue());
    }
    return urls
};


const KEYWORDS = ['narzędzie'];

(async () => {
    const puppeteer = require('puppeteer');
    const asTable = require('as-table').configure({dash: '', delimiter: '\t'});
    const fs = require('fs');

    const browser = await puppeteer.launch({
        // headless: false,
        args: ["--start-maximized"],
    });

    let authors = [];
    let page = await createPage(browser);
    let p = 0;
    while(true) {
        await searchByKeywords(page, KEYWORDS, p)
        let urls = await getPapersLinks(page);
        for(const url of urls) {
            let paperPage = await createPage(browser);
            console.log(`=> ${url}`);
            let newAuthors = await fetchAuthorsFromSite(url, paperPage);
            console.log(newAuthors);
            authors = [...authors, ...newAuthors];
            await paperPage.close();
        }

        if(await isNextPage(page))
            p++;
        else
            break;
    }

    authors = [...new Set(authors)];
    const filename = 'science-direct-' + KEYWORDS.join('_') + '.txt';
    fs.writeFileSync(filename, asTable(authors));
    console.log(asTable(authors));
    await browser.close();
})();