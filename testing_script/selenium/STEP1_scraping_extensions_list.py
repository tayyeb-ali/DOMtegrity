import time
import os
from selenium import webdriver
from selenium.webdriver.firefox.firefox_profile import FirefoxProfile
import urllib.request
import re
import zipfile
import subprocess
from shutil import copy2
from BOs.BExtension import BExtension
import json

currentDir = os.path.dirname(os.path.abspath(__file__))
chrome_exe = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

firefox_driver = currentDir + "\\Browsers\\geckodriver.exe"
download_path = currentDir + "\\extensions\\downloads\\"
print("DL PATH: " + download_path)
extension_list_scraped = open(currentDir + "\\extensions\\Extension_URL_list_scraped.txt", 'a', encoding='utf-8')

profile = FirefoxProfile()
profile.set_preference("browser.download.folderList", 2)
profile.set_preference("browser.download.manager.showWhenStarting", False)
profile.set_preference("browser.download.dir", download_path)

search_keyword_list = []
search_keywords = open(currentDir + "./extensions/search_keywords.txt", 'r', encoding='utf-8')
search_keyword_list = search_keywords.readlines()
search_keywords.close()
search_keyword_list = [x.strip() for x in search_keyword_list]

driver = webdriver.Firefox(executable_path=firefox_driver, firefox_profile=profile)

for search_keyword in search_keyword_list:
    driver.get('https://chrome.google.com/webstore/search/' + search_keyword)
    time.sleep(5)

    category_list = driver.find_elements_by_class_name('a-d-zc')

    url_list = []
    extension_url_list = []
    for category in category_list:
        url = category.get_attribute('href')
        if url != None and not (url.__contains__('_category=themes')):
            url_list.append(url)

    for url in url_list:
        driver.get(url)
        time.sleep(5)
        
        extension_list = driver.find_elements_by_class_name('a-u')
        for extension in extension_list:
            extension_url = extension.get_attribute('href')
            extension_url_list.append(extension_url)
            extension_list_scraped.write(extension_url + '\n')

extension_list_scraped.close()
driver.quit()