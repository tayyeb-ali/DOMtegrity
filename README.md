#  FILES OVERVIEW
---
## `./domtegrity-server.js`
The main server file which is run using node with the following command: `node domtegrity-server.js`
All required modules are predefined at the top of the file - most of these are pre-installed with NodeJS or have been included within this submission, others can be installed as needed using `npm install [module_name]`

## `./Client/index.html`
The basic web page designed to test each extension with a simple form submission.

## `./testing_script/selenium/STEP1_scraping_extensions_list.py`
The first script for the system run using the following command: `python STEP1_scraping_extensions_list.py`
All required modules are predefined at the top of the file - most of these are pre-installed with Python, others can be installed as needed using `pip install [module_name]`

## `./testing_script/selenium/STEP2_downloading_extensions.py`
The second script for the system run using the following command: `python STEP2_downloading_extensions.py`
All required modules are predefined at the top of the file - most of these are pre-installed with Python, others can be installed as needed using `pip install [module_name]`

## `./testing_script/selenium/STEP3_extracting_extensions.py`
The third script for the system run using the following command: `python STEP3_extracting_extensions.py`
All required modules are predefined at the top of the file - most of these are pre-installed with Python, others can be installed as needed using `pip install [module_name]`

## `./testing_script/selenium/STEP4_repacking_extensions.py`
The fourth script for the system run using the following command: `python STEP4_repacking_extensions.py`
All required modules are predefined at the top of the file - most of these are pre-installed with Python, others can be installed as needed using `pip install [module_name]`

## `./testing_script/selenium/STEP5_evaluating_extensions.py`
The final script for the system run using the following command: `python STEP5_evaluating_extensions.py`
All the required modules are predefined at the top of the file - most of these are pre-installed with Python, others can be installed as needed using `pip install [module_name]`

## `./testing_script./selenium./extensions/search_keywords.txt`
This file is used for the first script which scrapes the web store for extension URLs, simple text file which contains keywords separated by the newline character.

Custom extensions written for the unit tests are within the following directory: `./testing_script./selenium./extensions/downloads/extracted/custom`

# INSTRUCTIONS 

## The first thing you must do is identify the version of Google Chrome and Mozilla Firefox installed on your machine and download the appropriate version of the chromedriver and geckodriver for those versions, these files must be saved in the following directory: `./testing_script/selenium/Browsers`

1. Define the keywords which will be used to gather the extensions in the search_keywords.txt file.

2. Run the command `python STEP1_scraping_extensions_list.py` to download a list of URLs which are saved in the file `./testing_script/selenium/extensions/Extension_URL_list_scraped.txt`

3. Run the command `python STEP2_downloading_extensions.py` to iterate the list of URLs to download each extension, they are saved in the following directory: `./testing_script/selenium/extensions/downloads`

4. Run the command `python STEP3_extracting_extensions.py` to extract each downloaded extension to their individual folders, they are extracted to the following directory: `./testing_script/selenium/extensions/downloads/extracted`

5. Run the command `python STEP4_repacking_extensions.py` to repack each unpacked extension to the correct CRX3 format, they are saved in the following directory: `./testing_script/selenium/extensions/downloads/extracted`

6. Run the DOMtegrity Server using the command `node domtegrity-server.js` this will initialise the webserver.

7. Run the command `python STEP5_evaluating_extensions.py` this will evaluate each extension within the extracted folder until all have been evaluated. The output of this complete process is saved to the files within this directory: `./testing_script/selenium/results`
