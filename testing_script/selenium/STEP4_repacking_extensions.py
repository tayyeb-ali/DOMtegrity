import os
import subprocess
import shutil
import sys

currentDir = os.path.dirname(os.path.abspath(__file__))

sys.path.append(currentDir + '\\CRX3_Creator')

from CRX3_Creator import main

currentDir = os.path.dirname(os.path.abspath(__file__))

download_path = currentDir + "\\extensions\\downloads\\"
extracted_path = download_path + '\\extracted\\'


# Generate crx3 format files using CRX3_Creator in same folder of extension folder
print("Trying to generate crx3 files.")
count = 1;
extension_extracted = os.listdir(extracted_path)
for extension_file in extension_extracted:
    print();
    print("Generating crx3 for extension No. " + str(count) + " - " + extension_file);
    count += 1;
    if(os.path.isdir(extracted_path + extension_file)):
        main.package(extracted_path + extension_file, '', '')
        print("crx3 of " + extension_file + " has been generated in extracted")
        # Disk cleanup - delete extra folders
        shutil.rmtree(extracted_path + extension_file)
        os.remove(download_path + extension_file + '.crx')
