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

extension_list = open(currentDir + '\\extensions\\Extension_URL_list_scraped.txt', 'r', encoding='utf-8')  # ,encoding="utf8"

extension_urls = extension_list.readlines()
extension_urls = [x.strip() for x in extension_urls]

profile = FirefoxProfile()
profile.set_preference("browser.download.folderList", 2)
profile.set_preference("browser.download.manager.showWhenStarting", False)
profile.set_preference("browser.download.dir", download_path)

driver = webdriver.Firefox(executable_path=firefox_driver, firefox_profile=profile)

if not os.path.exists(download_path):
    os.makedirs(download_path)

count = 1
for ext in extension_urls:
    print()
    print("Trying to download extension no. " + str(count))
    count += 1
    # get extension information
    result = urllib.parse.urlparse(ext)
    if result.scheme != '':
        try:
            driver.get(ext)

            time.sleep(3)  # Let the user actually see something!
            try:
                extension_name = driver.find_element_by_class_name('e-f-w').text
            except:
                extension_name = "Not Mentioned"
            try:
                extension_producer = driver.find_element_by_class_name('e-f-Me').text
            except:
                extension_producer = "Not Mentioned"
            try:
                extension_categories = driver.find_elements_by_class_name('e-f-y')
                if len(extension_categories) == 2:
                    extension_category = extension_categories[1].text.replace(',', '')
                else:
                    extension_category = extension_categories[0].text.replace(',', '')
            except:
                extension_category = "Not Mentioned"
            try:
                extension_population = driver.find_element_by_class_name('e-f-ih').text.replace(',', '')
            except:
                extension_population = "Not Mentioned"
            try:
                extension_ratings = driver.find_element_by_class_name('rsw-stars').get_attribute(
                    'g:rating_override').replace(',', '')
            except:
                extension_ratings = "Not Mentioned"
            try:
                extension_no_people_rated = driver.find_element_by_class_name('q-N-nd').text.replace(',', '').replace('(',
                                                                                                                    '').replace(
                    ')', '')
            except:
                extension_no_people_rated = "Not Mentioned"

            try:
                extension_status = driver.find_element_by_class_name('webstore-test-button-label')
                print(extension_status.text)
            except:
                extension_status = "Not Mentioned"

            data =  {}
            try:
                with open(currentDir + "\\extensions\\ExtensionInformation.json",'r+') as json_file:
                    data = json.load(json_file)
            except:
                data['extensions'] = []

            str2 = ext.split('/')
            n = len(str2)

            be = BExtension()
            be.id = str2[n - 1]
            be.name = extension_name
            be.producer = extension_producer
            be.category = extension_category
            be.population = extension_population
            be.ratings = extension_ratings
            be.no_people_rated = extension_no_people_rated
            if extension_status.text:
                be.status = extension_status.text
            data['extensions'].append(be.toJSON1())
            with open(currentDir + "\\extensions\\ExtensionInformation.json",'w+') as json_file:
                json.dump(data, json_file, indent = 4, sort_keys = True)

            url = "https://clients2.google.com/service/update2/crx?response=redirect&os=win&arch=x86-64&os_arch=x86-64&nacl_arch=x86-64&prod=chromecrx&prodchannel=unknown&prodversion=89.0.4389.114&acceptformat=crx2,crx3&x=id%3D" + str2[n - 1] + "%26uc"
            try:
                extension_name = str2[n - 1]

                file_name = download_path + re.sub('[<>:"/\|?*,]', ' ', extension_name) + ".crx"
                try:
                    urllib.request.urlretrieve(url, file_name)
                    print("Extension %s [%s] downloaded" % (extension_name, extension_status.text))
                except:
                    print("Error in download [status]-%s" % (extension_status.text))
            except:
                errors_file = open('Error URL.txt', 'a', encoding='utf-8')
                errors_file.write(ext + '\n')
                errors_file.close()
        except Exception as e:
            print(str(e))
            errors_file = open('Error URL.txt', 'a', encoding='utf-8')
            errors_file.write(ext + '\n')
            errors_file.close()
        time.sleep(2)

driver.quit()