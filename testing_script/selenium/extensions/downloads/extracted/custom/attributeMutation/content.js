// Checking page URL
//if (document.URL.indexOf("localhost") != -1) {
    //Getting Elements

	//alert('ext1 test');
    // var txt = document.getElementById("username");
    // //Change to DOM 
	// if(txt){
	// 	txt.placeholder='new text for email';
	// }

	// var buttonTest = document.getElementById("buttonTest")
	// if(buttonTest){
	// 	alert('buttonTest found: ' + buttonTest);
	// 	buttonTest.addEventListener("click", function(e) {	
	// 		alert('abc');
	// 	});
	// }

	// function myAlert(){
	// 	alert('hello world');
	// }
	
	// document.addEventListener('DOMContentLoaded', function () {
		// document.getElementById("buttonTest").addEventListener("click", myAlert);

		var txt = document.getElementById("username");
		if(txt){
			txt.placeholder='new text for user name';
		}

		var submitbutton = document.getElementById("buttonTest");
		//alert(submitbutton);
		if(submitbutton){
			submitbutton.onclick = onButonClick.bind(submitbutton);
		}
	// });

	// 	alert('window.onload');
		var form = document.querySelector("form");
		if(form){
			//alert('form');
			form.onsubmit = submitted.bind(form);
		}
	
	function submitted(event) {
		alert('submitted');
		submit_values('form');
		event.preventDefault();
	}

	function onButonClick(event) {
		alert('submit button');
		submit_values('Button');
		event.preventDefault();
	}

	function submit_values(dsource){
		var username = document.getElementById("username").value;
		var password = document.getElementById("password").value;

		alert('source: ' + dsource + ', username: ' + username + ', password: ' + password);
	}
//}