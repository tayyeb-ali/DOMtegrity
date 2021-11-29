import time
import os
import urllib.request
import re
import zipfile
import subprocess
from shutil import copy2

currentDir = os.path.dirname(os.path.abspath(__file__))

download_path = currentDir + "\\extensions\\downloads\\"
extracted_path = download_path + 'extracted\\'

if not os.path.exists(extracted_path):
    os.makedirs(extracted_path)

count = 1;
for extension_name in os.listdir(download_path):
    if extension_name.endswith(".crx"):
        print();
        print("Extension No. " + str(count) + " - " + extension_name + " is being extracted.");
        count += 1;
        try:
            file_name = download_path + extension_name
            extension_folder = extension_name.replace(".crx", "")
            d = download_path + 'extracted\\' + extension_folder
            z = zipfile.ZipFile(file_name, mode='r')
            z.extractall(d)
            print(extension_name + " extracted")
        except Exception as e:
            print(str(e))
            errors_file = open('Error URL.txt', 'a', encoding='utf-8')
            errors_file.write(extension_name + '\n')
            errors_file.close()
