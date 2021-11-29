import time
import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from BOs.BExtensionResult import BExtensionResult
import json

currentDir = os.path.dirname(os.path.abspath(__file__))

chromedriver = currentDir + "\\Browsers\\chromedriver.exe"
extension_dir = currentDir + "\\extensions\\downloads\\extracted"

extension_name = os.listdir(extension_dir)

capabilities = DesiredCapabilities.CHROME
capabilities['goog:loggingPrefs'] = { 'browser':'ALL' } #'INFO'
capabilities['acceptSslCerts'] = True
capabilities['acceptInsecureCerts'] = True

count = 1;
for extension in extension_name:
    if extension.endswith(".crx"):
        print()
        print("Evaluating: " + str(count) + " - " + extension);
        count += 1;
        try:
            extension_name = extension
            options = webdriver.ChromeOptions()
            options.add_argument("--ignore-certificate-errors")
            options.add_experimental_option('excludeSwitches', ['enable-logging'])
            options.add_extension(extension_dir + '\\' + extension_name)
            driver = webdriver.Chrome(executable_path=chromedriver, options=options)
            try:
                driver.get('https://localhost:8080/')
                time.sleep(2) # Let the user actually see something!
                search_box = driver.find_element_by_id('buttonTest')
                search_box.click()

                time.sleep(2) # Let the user actually see something!

                log = ''

                for entry in driver.get_log('browser'):
                    if entry['source']=='console-api':
                        if "localhost:8080" in entry['message']:
                            log = str(entry['message'])

                if log == '':
                    log = '{"result":"No_Log_Recorded"}'
                    eval_file = open(currentDir + '\\results\\NoLogExtensionEvaluationPC.csv', 'a',encoding="utf8")
                    eval_file.write(extension + ' - ' + log + '\n')
                else:
                    eval_file = open(currentDir + '\\results\\MutationExtensionEvaluationPC.csv', 'a',encoding="utf8")
                    eval_file.write(extension + ' - ' + log + '\n')
                    log = log.split(' ')[2]

                with open(currentDir + '\\extensions\\ExtensionInformation.json','r+') as json_file:
                    data = json.load(json_file)

                id = extension.replace(".crx", "")                    
                output_dict = [x for x in data['extensions'] if x['id'] == id]
                if len(output_dict) <= 0:
                    print(id +' Extention not found in given list')
                else:
                    extension_name = output_dict[0]['name']

                    result = json.loads(log)
                    ber = BExtensionResult()
                    ber.name = extension_name
                    ber.result = result
                    data =  {}
                    try:
                        with open(currentDir + '\\results\\MutationExtensionEvaluationPC.json','r+') as json_file:
                            data = json.load(json_file)
                    except:
                        data['extensions'] = []

                    data['extensions'].append(ber.toJSON1())
                    with open(currentDir + '\\results\\MutationExtensionEvaluationPC.json','w+') as json_file:
                        json.dump(data, json_file, indent = 4, sort_keys = True)

            except Exception as e:
                print('Not started ' + str(e))

            driver.quit()
        except Exception as e:
            print('Not started ' + str(e))
            eval_file = open(currentDir + '\\errors\\ExtensionEvaluationPCErrors.csv', 'a',encoding="utf8")
            eval_file.write(extension + ',' + 'Chrome Not Started!' + '\n')